import { NextResponse } from 'next/server';
import { getReadingRoomIndex, uploadToReadingRoom, downloadNovelFromReadingRoom, type ReadingRoomMetadata } from '@/lib/google-drive-admin-v2';
import { createClient } from '@/lib/supabase/server';
import _fs from 'fs';
import path from 'path';
import os from 'os';

let HAS_FS = false;
try {
    HAS_FS = typeof _fs.existsSync === 'function';
    if (HAS_FS) _fs.existsSync(os.tmpdir());
} catch (e) {
    HAS_FS = false;
}

const RAM_CACHE = new Map<string, any>();

// Shim cho Môi trường Cloudflare Edge (không có truy cập File System)
const fs = {
    existsSync: (p: string) => HAS_FS ? _fs.existsSync(p) : RAM_CACHE.has(p),
    mkdirSync: (p: string, opts?: any) => HAS_FS ? _fs.mkdirSync(p, opts) : undefined,
    writeFileSync: (p: string, data: any, enc?: any) => HAS_FS ? _fs.writeFileSync(p, data, enc) : RAM_CACHE.set(p, data),
    appendFileSync: (p: string, data: any) => {
        if (HAS_FS) _fs.appendFileSync(p, data);
        else RAM_CACHE.set(p, (RAM_CACHE.get(p) || '') + data);
    },
    readFileSync: (p: string, enc?: any) => HAS_FS ? _fs.readFileSync(p, enc) : RAM_CACHE.get(p),
    unlinkSync: (p: string) => HAS_FS ? _fs.unlinkSync(p) : RAM_CACHE.delete(p),
};

const CACHE_DIR = path.join(os.tmpdir(), 'novel-studio-reading-room');

/** Ensure cache directory exists before any write */
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

/** Helper to split a large novel into smaller chapter-scenes chunks on disk */
function splitNovelToChunks(novelId: string, data: any) {
    const novelDir = path.join(CACHE_DIR, novelId);
    if (!fs.existsSync(novelDir)) {
        fs.mkdirSync(novelDir, { recursive: true });
    }

    // Save Meta
    const meta = {
        novel: data.novel,
        chapters: data.chapters?.sort((a: any, b: any) => a.order - b.order) || [],
    };
    fs.writeFileSync(path.join(novelDir, 'meta.json'), JSON.stringify(meta), 'utf-8');

    // Save Scenes in chunks of 20 chapters to keep files small
    const chapters = meta.chapters;
    const CHUNK_SIZE = 20;
    for (let i = 0; i < chapters.length; i += CHUNK_SIZE) {
        const chunkChapters = chapters.slice(i, i + CHUNK_SIZE);
        const chunkChapterIds = new Set(chunkChapters.map((c: any) => c.id));
        const chunkScenes = data.scenes?.filter((s: any) => chunkChapterIds.has(s.chapterId)) || [];

        fs.writeFileSync(
            path.join(novelDir, `chunk_${Math.floor(i / CHUNK_SIZE)}.json`),
            JSON.stringify(chunkScenes),
            'utf-8'
        );
    }

    // Mark as split
    fs.writeFileSync(path.join(novelDir, '.split'), Date.now().toString());
}

export const maxDuration = 60; // seconds

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        if (action === 'list') {
            const index = await getReadingRoomIndex();
            return NextResponse.json({ success: true, novels: index });
        }

        if (action === 'novel_data') {
            const novelId = searchParams.get('id');
            if (!novelId) return NextResponse.json({ error: 'Missing novel ID' }, { status: 400 });

            ensureCacheDir();
            const novelDir = path.join(CACHE_DIR, novelId);
            const metaFile = path.join(novelDir, 'meta.json');

            // If not split-cached, try to download and split
            if (!fs.existsSync(metaFile)) {
                const fullDataStr = await downloadNovelFromReadingRoom(novelId);
                if (!fullDataStr) return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
                const data = JSON.parse(fullDataStr);
                splitNovelToChunks(novelId, data);
                // Also save the full file for 'download_full' action
                fs.writeFileSync(path.join(CACHE_DIR, `${novelId}.json`), fullDataStr);
            }

            const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
            const index = await getReadingRoomIndex();
            const indexMeta = index.find(n => n.id === novelId);
            const returnedNovel = { ...meta.novel, uploaderId: indexMeta?.uploaderId };

            return NextResponse.json({
                success: true,
                novel: returnedNovel,
                chapters: meta.chapters
            });
        }

        if (action === 'chapter') {
            const novelId = searchParams.get('id');
            const chapterIdx = searchParams.get('idx');
            if (!novelId || !chapterIdx) {
                return NextResponse.json({ error: 'Missing ID or Index' }, { status: 400 });
            }

            ensureCacheDir();
            const novelDir = path.join(CACHE_DIR, novelId);
            const metaFile = path.join(novelDir, 'meta.json');

            // Ensure we have split cache
            if (!fs.existsSync(metaFile)) {
                const fullDataStr = await downloadNovelFromReadingRoom(novelId);
                if (!fullDataStr) return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
                const data = JSON.parse(fullDataStr);
                splitNovelToChunks(novelId, data);
                fs.writeFileSync(path.join(CACHE_DIR, `${novelId}.json`), fullDataStr);
            }

            const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
            const idx = Number(chapterIdx);
            if (idx < 0 || idx >= meta.chapters.length) {
                return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
            }

            const targetChapter = meta.chapters[idx];

            // Security check for locked chapters
            if (targetChapter.isLocked) {
                const supabase = await createClient();
                const { data: { user } } = await supabase.auth.getUser();
                const index = await getReadingRoomIndex();
                const indexMeta = index.find(n => n.id === novelId);
                if (!user || user.id !== indexMeta?.uploaderId) {
                    return NextResponse.json({ error: 'Chương này đã bị khóa' }, { status: 403 });
                }
            }

            // Load only the relevant chunk
            const chunkIdx = Math.floor(idx / 20);
            const chunkFile = path.join(novelDir, `chunk_${chunkIdx}.json`);
            if (!fs.existsSync(chunkFile)) {
                return NextResponse.json({ error: 'Chunk data missing' }, { status: 500 });
            }

            const chunkScenes = JSON.parse(fs.readFileSync(chunkFile, 'utf-8'));
            const targetScenes = chunkScenes.filter((s: any) =>
                s.chapterId === targetChapter.id && (s.isActive === 1 || s.isActive === undefined)
            ).sort((a: any, b: any) => a.order - b.order);

            return NextResponse.json({
                success: true,
                chapter: targetChapter,
                scenes: targetScenes,
            });
        }

        if (action === 'download_full') {
            const novelId = searchParams.get('id');
            if (!novelId) return NextResponse.json({ error: 'Missing novel ID' }, { status: 400 });

            ensureCacheDir();
            const cacheFile = path.join(CACHE_DIR, `${novelId}.json`);

            if (!fs.existsSync(cacheFile)) {
                const fullDataBytes = await downloadNovelFromReadingRoom(novelId, true);
                if (!fullDataBytes) return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
                fs.writeFileSync(cacheFile, fullDataBytes);
            }

            const data = fs.readFileSync(cacheFile);
            const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
            const headers = new Headers();
            headers.set('Content-Type', 'application/json');
            if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
                headers.set('Content-Encoding', 'gzip');
            }
            return new NextResponse(bytes, { headers });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('Reading Room GET Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        let uploaderName = 'Ẩn danh';
        const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', user.id).single();
        if (profile?.display_name) {
            uploaderName = profile.display_name;
        } else if (user.user_metadata?.custom_name) {
            uploaderName = user.user_metadata.custom_name;
        }

        if (action === 'upload') {
            const novelId = searchParams.get('novelId');
            if (!novelId) return NextResponse.json({ error: 'Missing novelId' }, { status: 400 });

            const metadataHeader = req.headers.get('x-novel-metadata');
            if (metadataHeader) {
                const metadata = JSON.parse(decodeURIComponent(metadataHeader)) as ReadingRoomMetadata;
                metadata.uploaderName = uploaderName;
                metadata.uploaderId = user.id;
                metadata.updatedAt = Date.now();

                const contentBuffer = await req.arrayBuffer();
                const contentBytes = new Uint8Array(contentBuffer);
                await uploadToReadingRoom(novelId, metadata, contentBytes);

                if (HAS_FS) {
                    try {
                        const { decompress } = await import('@/lib/compression');
                        const decompressedText = await decompress(contentBytes);
                        const parseData = JSON.parse(decompressedText);
                        ensureCacheDir();
                        const cacheFile = path.join(CACHE_DIR, `${novelId}.json`);
                        fs.writeFileSync(cacheFile, decompressedText);
                        splitNovelToChunks(novelId, parseData);
                    } catch (e) {
                        console.error('Lỗi giải nén cache cục bộ:', e);
                    }
                }
                return NextResponse.json({ success: true });
            } else {
                const content = await req.text();
                let parseData;
                try {
                    parseData = JSON.parse(content);
                } catch (err) {
                    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
                }

                const novel = parseData.novel;
                const chapters = parseData.chapters || [];

                const metadata: ReadingRoomMetadata = {
                    id: novelId,
                    title: novel.title,
                    author: novel.author,
                    description: novel.description,
                    coverImage: novel.coverImage,
                    chapterCount: chapters.length,
                    uploaderName: uploaderName,
                    uploaderId: user.id,
                    genres: novel.genres || [],
                    updatedAt: Date.now(),
                };

                await uploadToReadingRoom(novelId, metadata, content);

                if (HAS_FS) {
                    ensureCacheDir();
                    const cacheFile = path.join(CACHE_DIR, `${novelId}.json`);
                    fs.writeFileSync(cacheFile, content);
                    splitNovelToChunks(novelId, parseData);
                }

                return NextResponse.json({ success: true });
            }
        }

        if (action === 'upload_chunk') {
            const uploadId = searchParams.get('uploadId');
            const chunkIndex = Number(searchParams.get('chunkIndex'));
            const totalChunks = Number(searchParams.get('totalChunks'));
            const novelId = searchParams.get('novelId');

            if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks) || !novelId) {
                return NextResponse.json({ error: 'Missing chunk info' }, { status: 400 });
            }

            const chunkData = await req.text();
            ensureCacheDir();
            const tempFile = path.join(CACHE_DIR, `upload_${uploadId}.tmp`);

            if (chunkIndex === 0) {
                fs.writeFileSync(tempFile, chunkData);
            } else {
                fs.appendFileSync(tempFile, chunkData);
            }

            if (chunkIndex === totalChunks - 1) {
                // Finalize
                const content = fs.readFileSync(tempFile, 'utf-8');
                fs.unlinkSync(tempFile);

                let parseData;
                try {
                    parseData = JSON.parse(content);
                } catch (err) {
                    return NextResponse.json({ error: 'Invalid JSON body in assembled chunks' }, { status: 400 });
                }

                const novel = parseData.novel;
                const chapters = parseData.chapters || [];

                const metadata: ReadingRoomMetadata = {
                    id: novelId,
                    title: novel.title,
                    author: novel.author,
                    description: novel.description,
                    coverImage: novel.coverImage,
                    chapterCount: chapters.length,
                    uploaderName: uploaderName,
                    uploaderId: user.id,
                    genres: novel.genres || [],
                    updatedAt: Date.now(),
                };

                await uploadToReadingRoom(novelId, metadata, content);

                // Cache final version and Split (chỉ chạy ở môi trường localhost có File System thực tế để tránh tràn bộ nhớ V8/timeout trên Cloudflare Pages)
                if (HAS_FS) {
                    const cacheFile = path.join(CACHE_DIR, `${novelId}.json`);
                    fs.writeFileSync(cacheFile, content);
                    splitNovelToChunks(novelId, parseData);
                }

                return NextResponse.json({ success: true, finalized: true });
            }

            return NextResponse.json({ success: true, chunkIndex });
        }

        if (action === 'edit_metadata') {
            const novelId = searchParams.get('novelId');
            if (!novelId) return NextResponse.json({ error: 'Missing novelId' }, { status: 400 });

            const content = await req.text();
            let newTitle: string | undefined = undefined;
            let newDescription: string | undefined = undefined;
            try {
                const b = JSON.parse(content);
                newTitle = b.newTitle;
                newDescription = b.newDescription;
            } catch {
                return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            }

            const { editMetadataInReadingRoom } = await import('@/lib/google-drive-admin-v2');
            try {
                await editMetadataInReadingRoom(novelId, newTitle || '', newDescription, user.id);
                // Xóa cache
                const cacheFile = path.join(os.tmpdir(), 'novel-studio-reading-room', `${novelId}.json`);
                if (fs.existsSync(cacheFile)) {
                    fs.unlinkSync(cacheFile);
                }
                return NextResponse.json({ success: true });
            } catch (err: any) {
                return NextResponse.json({ error: err.message }, { status: 403 });
            }
        }

        if (action === 'toggle_chapter_lock') {
            const novelId = searchParams.get('novelId');
            const chapterIdx = searchParams.get('idx');
            if (!novelId || !chapterIdx) return NextResponse.json({ error: 'Missing Data' }, { status: 400 });

            const { toggleChapterLockInReadingRoom } = await import('@/lib/google-drive-admin-v2');
            try {
                const newLockStatus = await toggleChapterLockInReadingRoom(novelId, Number(chapterIdx), user.id);
                const cacheFile = path.join(os.tmpdir(), 'novel-studio-reading-room', `${novelId}.json`);
                if (fs.existsSync(cacheFile)) {
                    fs.unlinkSync(cacheFile);
                }
                return NextResponse.json({ success: true, isLocked: newLockStatus });
            } catch (err: any) {
                return NextResponse.json({ error: err.message }, { status: 403 });
            }
        }

        if (action === 'delete') {
            const novelId = searchParams.get('novelId');
            if (!novelId) return NextResponse.json({ error: 'Missing novelId' }, { status: 400 });

            // Ensure they are the uploader or ADMIN
            let isAllowed = false;
            const admins = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com"];
            if (admins.includes(user.email || '')) {
                isAllowed = true;
            } else {
                const index = await getReadingRoomIndex();
                const indexMeta = index.find(n => n.id === novelId);
                if (indexMeta && indexMeta.uploaderId === user.id) {
                    isAllowed = true;
                }
            }

            if (!isAllowed) {
                return NextResponse.json({ error: 'Unauthorized. Bạn không phải là admin hoặc tác giả đăng bộ này.' }, { status: 403 });
            }

            const { deleteFromReadingRoom } = await import('@/lib/google-drive-admin-v2');
            try {
                await deleteFromReadingRoom(novelId);
                // Clear cache on local proxy
                const cacheFile = path.join(os.tmpdir(), 'novel-studio-reading-room', `${novelId}.json`);
                if (fs.existsSync(cacheFile)) {
                    fs.unlinkSync(cacheFile);
                }
                return NextResponse.json({ success: true });
            } catch (err: any) {
                return NextResponse.json({ error: err.message }, { status: 500 });
            }
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('Reading Room POST Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
