import { NextResponse } from 'next/server';
import { getReadingRoomIndex, uploadToReadingRoom, downloadNovelFromReadingRoom, type ReadingRoomMetadata } from '@/lib/google-drive-admin-v2';
import { createClient } from '@/lib/supabase/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.tmpdir(), 'novel-studio-reading-room');

/** Ensure cache directory exists before any write */
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
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

            // Cache folder
            ensureCacheDir();
            const cacheFile = path.join(CACHE_DIR, `${novelId}.json`);

            // If we don't have it cached or need to force refresh
            if (!fs.existsSync(cacheFile)) {
                const fullDataStr = await downloadNovelFromReadingRoom(novelId);
                if (!fullDataStr) {
                    return NextResponse.json({ error: 'Novel not found in Reading Room' }, { status: 404 });
                }
                fs.writeFileSync(cacheFile, fullDataStr, 'utf-8');
            }

            // Read from cache to get metadata (exclude full chapters)
            const dataStr = fs.readFileSync(cacheFile, 'utf-8');
            const data = JSON.parse(dataStr);

            // Return metadata + list of chapters but NOT the scenes content for speed
            const chaptersList = data.chapters?.sort((a: any, b: any) => a.order - b.order).map((ch: any) => ({
                id: ch.id,
                novelId: ch.novelId,
                title: ch.title,
                order: ch.order,
                isLocked: ch.isLocked || false,
            })) || [];

            // Add uploaderId from index
            const index = await getReadingRoomIndex();
            const indexMeta = index.find(n => n.id === novelId);
            const returnedNovel = { ...data.novel, uploaderId: indexMeta?.uploaderId };

            return NextResponse.json({
                success: true,
                novel: returnedNovel,
                chapters: chaptersList
            });
        }

        if (action === 'chapter') {
            const novelId = searchParams.get('id');
            const chapterIdx = searchParams.get('idx');
            if (!novelId || !chapterIdx) {
                return NextResponse.json({ error: 'Missing ID or Index' }, { status: 400 });
            }

            ensureCacheDir();
            const cacheFile = path.join(CACHE_DIR, `${novelId}.json`);

            let dataStr = '';
            if (!fs.existsSync(cacheFile)) {
                const fullDataStr = await downloadNovelFromReadingRoom(novelId);
                if (!fullDataStr) {
                    return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
                }
                fs.writeFileSync(cacheFile, fullDataStr, 'utf-8');
                dataStr = fullDataStr;
            } else {
                dataStr = fs.readFileSync(cacheFile, 'utf-8');
            }

            const data = JSON.parse(dataStr);
            const sortedChapters = data.chapters?.sort((a: any, b: any) => a.order - b.order) || [];
            const idx = Number(chapterIdx);

            if (idx < 0 || idx >= sortedChapters.length) {
                return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
            }

            const targetChapter = sortedChapters[idx];

            if (targetChapter.isLocked) {
                // Determine if user is uploader
                const { createClient } = await import('@/lib/supabase/server');
                const supabase = await createClient();
                const { data: { user } } = await supabase.auth.getUser();

                const index = await getReadingRoomIndex();
                const indexMeta = index.find(n => n.id === novelId);
                if (!user || user.id !== indexMeta?.uploaderId) {
                    return NextResponse.json({ error: 'Chương này đã bị khóa bởi người tải lên' }, { status: 403 });
                }
            }

            // Lấy danh sách scenes thuộc chapterId (chỉ lấy scene đang active)
            const targetScenes = data.scenes?.filter((s: any) => s.chapterId === targetChapter.id && (s.isActive === 1 || s.isActive === undefined))?.sort((a: any, b: any) => a.order - b.order) || [];

            return NextResponse.json({
                success: true,
                chapter: targetChapter,
                scenes: targetScenes,
            });
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

            let content = await req.text();
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

            // Force refresh cache if it exists on this server
            const cacheFile = path.join(os.tmpdir(), 'novel-studio-reading-room', `${novelId}.json`);
            if (fs.existsSync(cacheFile)) {
                fs.unlinkSync(cacheFile); // Xoá cache để update file mới
            }

            return NextResponse.json({ success: true });
        }

        if (action === 'edit_metadata') {
            const novelId = searchParams.get('novelId');
            if (!novelId) return NextResponse.json({ error: 'Missing novelId' }, { status: 400 });

            let content = await req.text();
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
            if (user.email === 'thanhxnamcoder@gmail.com') { // Admin check (fallback)
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
