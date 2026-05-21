import { NextResponse } from 'next/server';
import { getReadingRoomIndex, uploadToReadingRoom, downloadNovelFromReadingRoom, type ReadingRoomMetadata } from '@/lib/google-drive-admin-v2';
import { createClient } from '@/lib/supabase/server';
import _fs from 'fs';
import path from 'path';
import os from 'os';

let HAS_FS = false;
try {
    HAS_FS = typeof _fs.writeFileSync === 'function';
    if (HAS_FS) {
        const testFile = path.join(os.tmpdir(), `fs_test_${Date.now()}.tmp`);
        _fs.writeFileSync(testFile, 'test');
        _fs.unlinkSync(testFile);
    }
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

async function searchDuckDuckGo(query: string): Promise<string> {
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Accept-Language': 'vi,en;q=0.9'
            }
        });
        if (!response.ok) {
            throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
        }
        const html = await response.text();
        const cheerio = await import('cheerio');
        const $ = cheerio.load(html);

        const snippets: string[] = [];
        $('.result').slice(0, 5).each((i, el) => {
            const title = $(el).find('.result__title').text().trim();
            const snippet = $(el).find('.result__snippet').text().trim();
            if (title && snippet) {
                snippets.push(`[${i + 1}] ${title}\nThông tin: ${snippet}`);
            }
        });

        if (snippets.length === 0) {
            const matchSnippetRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
            let match;
            let count = 1;
            while ((match = matchSnippetRegex.exec(html)) !== null && count <= 5) {
                const cleanText = match[1].replace(/<[^>]*>/g, '').trim();
                if (cleanText) {
                    snippets.push(`[${count}] ${cleanText}`);
                    count++;
                }
            }
        }

        return snippets.join('\n\n');
    } catch (e: any) {
        console.error("DuckDuckGo search query failed:", e);
        return `Không thể tìm kiếm tự động trên web: ${e.message}`;
    }
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const action = searchParams.get('action');

        if (action === 'search_web') {
            const query = searchParams.get('q');
            if (!query) return NextResponse.json({ error: 'Missing query q' }, { status: 400 });
            const results = await searchDuckDuckGo(query);
            return NextResponse.json({ success: true, results });
        }

        if (action === 'list') {
            const index = await getReadingRoomIndex();
            return NextResponse.json({ success: true, novels: index });
        }

        if (action === 'get_classify_config') {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

            const admins = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com", "test@example.com"];
            if (!admins.includes(user.email || '')) {
                return NextResponse.json({ error: 'Unauthorized. Chỉ dành cho Admin.' }, { status: 403 });
            }

            const { data: settingsData } = await supabase
                .from("app_settings")
                .select("key, value");

            const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
                acc[curr.key] = curr.value;
                return acc;
            }, {});

            const rawUrl = settingsMap["admin_proxy_url"] || "";
            const rawKey = settingsMap["admin_proxy_key"] || "";
            const rawModel = settingsMap["admin_classify_model"] || "gemini-2.5-flash-search";

            const maskedKey = rawKey ? "••••••••••••" : "";

            return NextResponse.json({
                success: true,
                proxyUrl: rawUrl,
                apiKey: maskedKey,
                model: rawModel
            });
        }

        if (action === 'get_classification_lists') {
            const index = await getReadingRoomIndex();

            const unclassified = index.filter(n =>
                (!n.genres || n.genres.length === 0)
            ).map(n => ({
                id: n.id,
                title: n.title,
                author: n.author,
                coverImage: n.coverImage,
                chapterCount: n.chapterCount,
                uploaderName: n.uploaderName
            }));

            const classified = index.filter(n =>
                (n.genres && n.genres.length > 0)
            ).map(n => ({
                id: n.id,
                title: n.title,
                author: n.author,
                coverImage: n.coverImage,
                chapterCount: n.chapterCount,
                uploaderName: n.uploaderName,
                genres: n.genres || []
            }));

            return NextResponse.json({
                success: true,
                unclassified,
                classified
            });
        }

        if (action === 'get_available_models') {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

            const admins = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com", "test@example.com"];
            if (!admins.includes(user.email || '')) {
                return NextResponse.json({ error: 'Unauthorized. Chỉ dành cho Admin.' }, { status: 403 });
            }

            const { data: settingsData } = await supabase
                .from("app_settings")
                .select("key, value");

            const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
                acc[curr.key] = curr.value;
                return acc;
            }, {});

            const rawUrl = settingsMap["admin_proxy_url"] || "";
            const rawKey = settingsMap["admin_proxy_key"] || "";

            if (!rawUrl) {
                return NextResponse.json({ error: 'Chưa cấu hình Proxy API URL.' }, { status: 400 });
            }

            try {
                const modelsUrl = `${rawUrl.replace(/\/+$/, "")}/models`;
                const headers: Record<string, string> = {};
                if (rawKey) {
                    headers["Authorization"] = `Bearer ${rawKey}`;
                }
                const res = await fetch(modelsUrl, { headers, method: "GET" });
                if (!res.ok) {
                    throw new Error(`Server proxy trả về mã lỗi: ${res.status}`);
                }
                const body = await res.json();
                const models = (body?.data || []).map((m: any) => m.id);
                return NextResponse.json({ success: true, models });
            } catch (err: any) {
                return NextResponse.json({ error: `Không thể kết nối API URL: ${err.message}` }, { status: 550 });
            }
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
            let uploaderId = meta.novel?.uploaderId;
            if (!uploaderId) {
                const index = await getReadingRoomIndex();
                const indexMeta = index.find(n => n.id === novelId);
                if (indexMeta?.uploaderId) {
                    uploaderId = indexMeta.uploaderId;
                    if (!meta.novel) meta.novel = {};
                    meta.novel.uploaderId = uploaderId;
                    try {
                        fs.writeFileSync(metaFile, JSON.stringify(meta), 'utf-8');
                    } catch (e) {
                        console.error("Failed to write uploaderId update into meta.json", e);
                    }
                }
            }

            let mottruyenGenre = "";
            let mottruyenIntro = "";
            if (novelId.startsWith("mottruyen-")) {
                try {
                    const storyId = novelId.replace("mottruyen-", "");
                    const mtRes = await fetch(`http://api.mottruyen.com/story/?story_id=${storyId}`, {
                        signal: AbortSignal.timeout(6000)
                    });
                    if (mtRes.ok) {
                        const mtData = await mtRes.json();
                        if (mtData && mtData.success === 1 && mtData.data) {
                            mottruyenGenre = mtData.data.KIND || "";
                            mottruyenIntro = mtData.data.INTRO || "";
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch Mottruyen metadata for mapping", e);
                }
            }

            const returnedNovel = {
                ...meta.novel,
                uploaderId: uploaderId,
                mottruyenGenre: mottruyenGenre || undefined,
                mottruyenIntro: mottruyenIntro || undefined
            };

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
                totalChapters: meta.chapters.length,
                novelTitle: meta.novel?.title || "Reading Room",
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

            // Decompress on server-side to avoid issues with manual Content-Encoding: gzip on Cloudflare Edge
            const { decompressIfNeeded } = await import('@/lib/compression');
            const decompressedText = await decompressIfNeeded(bytes);

            return new NextResponse(decompressedText, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                }
            });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('Reading Room GET Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
async function classifyNovelAI(
    novelId: string,
    title: string,
    description: string,
    proxyUrlRaw: string,
    proxyKey: string,
    rawModel: string,
    userId: string,
    isUserAdmin: boolean
): Promise<string[]> {
    let proxyUrl = proxyUrlRaw.trim().replace(/[^\x20-\x7E]/g, '');
    if (!proxyUrl.includes("/chat/completions")) {
        proxyUrl = proxyUrl.replace(/\/+$/, "") + "/chat/completions";
    }

    const CATEGORY_GROUPS: Record<string, string[]> = {
        "Thể loại": [
            "Tiên Hiệp", "Huyền Huyễn", "Khoa Huyễn", "Võng Du", "Đô Thị", "Đồng Nhân", "Dã Sử", "Cạnh Kỹ", "Huyền Nghi", "Kiếm Hiệp", "Kỳ Ảo", "Light Novel", "Hiện Đại Ngôn Tình", "Huyền Huyễn Ngôn Tình", "Tiên Hiệp Kỳ Duyên", "Cổ Đại Ngôn Tình", "Huyền Nghi Thần Quái", "Khoa Huyễn Không Gian", "Lãng Mạn Thanh Xuân"
        ],
        "Tính cách": [
            "Điềm Đạm", "Nhiệt Huyết", "Vô Sỉ", "Thiết Huyết", "Nhẹ Nhàng", "Cơ Trí", "Lãnh Khốc", "Kiêu Ngạo", "Ngu Ngốc"
        ],
        "Bối cảnh": [
            "Đông Phương Huyền Huyễn", "Dị Thế Đại Lục", "Vương Triều Tranh Bá", "Cao Võ Thế Giới", "Tây Phương Kỳ Huyễn", "Hiện Đại Ma Pháp", "Hắc Ám Huyền Tưởng", "Lịch Sử Thần Thoại", "Võ Hiệp Huyền Tưởng", "Cổ Võ Tương Lai", "Tu Chân Văn Minh", "Huyền Tưởng Tu Tiên", "Hiện Đại Tu Chân", "Thần Thoại Tu Chân", "Cổ Điển Tiên Hiệp", "Viễn Cổ Hồng Hoang", "Đô Thị Sinh Hoạt", "Đô Thị Dị Năng", "Thanh Xuân Vườn Trường", "Ngu Nhạc Minh Tinh", "Thương Chiến Chức Tràng", "Giả Không Lịch Sử", "Lịch Sử Quân Sự", "Dân Gian Truyền Thuyết", "Lịch Sử Quan Trường", "Hư Nghĩ Võng Du", "Du Hí Dị Giới", "Điện Tử Cạnh Kỹ", "Thể Dục Cạnh Kỹ", "Cổ Võ Cơ Giáp", "Thế Giới Tương Lai", "Tinh Tế Văn Minh", "Tiến Hóa Biến Di", "Mạt Thế Nguy Cơ", "Thời Không Xuyên Toa", "Quỷ Bí Huyền Nghi", "Kỳ Diệu Thế Giới", "Trinh Thám Thôi Lý", "Thám Hiểm Sinh Tồn", "Cung Vi Trạch Đấu", "Kinh Thương Chủng Điền", "Tiên Lữ Kỳ Duyên", "Hào Môn Thế Gia", "Dị Tộc Luyến Tình", "Ma Pháp Huyền Tình", "Tinh Tế Luyến Ca", "Linh Khí Khôi Phục", "Chư Thiên Vạn Giới", "Nguyên Sinh Huyền Tưởng", "Yêu Đương Thường Ngày", "Diễn Sinh Đồng Nhân", "Cáo Tiểu Thổ Tào"
        ],
        "Lưu phái": [
            "Hệ Thống", "Lão Gia", "Bàn Thờ", "Tùy Thân", "Phàm Nhân", "Vô Địch", "Xuyên Qua", "Nữ Cường", "Khế Ước", "Trọng Sinh", "Hồng Lâu", "Học Viện", "Biến Thân", "Cổ Ngu", "Chuyển Thế", "Xuyên Sách", "Đàn Xuyên", "Phế Tài", "Dưỡng Thành", "Cơm Mềm", "Vô Hạn", "Mary Sue", "Cá Mặn", "Xây Dựng Thế Lực", "Xuyên Nhanh", "Nữ Phụ", "Vả Mặt", "Sảng Văn", "Xuyên Không", "Ngọt Sủng", "Ngự Thú", "Điền Viên", "Toàn Dân", "Mỹ Thực", "Phản Phái", "Sau Màn", "Thiên Tài"
        ]
    };
    const STANDARD_GENRES = Object.values(CATEGORY_GROUPS).flat();
    const genreListStr = STANDARD_GENRES.join(", ");

    let mottruyenGenre = "";
    let mottruyenIntro = "";

    if (novelId.startsWith("mottruyen-")) {
        try {
            const storyId = novelId.replace("mottruyen-", "");
            const mtRes = await fetch(`http://api.mottruyen.com/story/?story_id=${storyId}`, {
                signal: AbortSignal.timeout(2000)
            });
            if (mtRes.ok) {
                const mtData = await mtRes.json();
                if (mtData && mtData.success === 1 && mtData.data) {
                    mottruyenGenre = mtData.data.KIND || "";
                    mottruyenIntro = mtData.data.INTRO || "";
                }
            }
        } catch (e) {
            console.error("Mottruyen metadata query failed inside classify helper", e);
        }
    }

    const finalDesc = description || mottruyenIntro || "";
    const mottruyenContext = mottruyenGenre ? `\n\nTHỂ LOẠI GỐC (từ nguồn Mottruyen): ${mottruyenGenre}` : "";

    const systemsPrompt = `Bạn là một chuyên gia phân loại thể loại tiểu thuyết mạng. Hãy phân loại thể loại cho bộ truyện dựa vào tên và mô tả. Chọn tối đa 1 đến 4 thể loại KHỚP NHẤT từ danh sách sau: ${genreListStr}.`;
    const usrsPrompt = `Tên truyện: ${title}\nMô tả:\n${finalDesc}${mottruyenContext}\n\nTrả về DUY NHẤT một mảng JSON các chuỗi tương ứng với các thể loại được chọn, không giải thích gì thêm, ví dụ: ["Huyền huyễn", "Hệ thống"].`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json"
    };
    if (proxyKey) {
        headers["Authorization"] = `Bearer ${proxyKey}`;
    }

    const apiRes = await fetch(proxyUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model: rawModel,
            messages: [
                { role: "system", content: systemsPrompt },
                { role: "user", content: usrsPrompt }
            ],
            temperature: 0.1
        }),
        signal: AbortSignal.timeout(25000)
    });

    if (!apiRes.ok) {
        throw new Error(`Server proxy trả về mã lỗi: ${apiRes.status}`);
    }

    const resJson = await apiRes.ok ? await apiRes.json() : null;
    if (!resJson) {
        throw new Error("Không nhận được phản hồi từ AI");
    }
    const text = resJson.choices?.[0]?.message?.content || "";
    let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const startIdx = cleaned.indexOf("[");
    const endIdx = cleaned.lastIndexOf("]");
    if (startIdx !== -1 && endIdx !== -1) {
        cleaned = cleaned.substring(startIdx, endIdx + 1);
    }
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Dữ liệu thể loại trả về rỗng hoặc không đúng định dạng");
    }

    const newGenres = parsed.map((s: any) => String(s).trim()).filter(Boolean);
    const { editMetadataInReadingRoom } = await import('@/lib/google-drive-admin-v2');
    await editMetadataInReadingRoom(novelId, title, finalDesc, userId, newGenres, isUserAdmin);

    const cacheFile = path.join(os.tmpdir(), 'novel-studio-reading-room', `${novelId}.json`);
    if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
    }
    return newGenres;
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

                // Restore full description and genres from compressed JSON body (avoiding Cloudflare header size limits)
                try {
                    const { decompress } = await import('@/lib/compression');
                    const decompressedText = await decompress(contentBytes);
                    const parseData = JSON.parse(decompressedText);
                    if (parseData?.novel?.description) {
                        metadata.description = parseData.novel.description;
                    }
                    if (parseData?.novel?.genres) {
                        metadata.genres = parseData.novel.genres;
                    }

                    // Write cache if filesystem is writable
                    if (HAS_FS) {
                        try {
                            ensureCacheDir();
                            const cacheFile = path.join(CACHE_DIR, `${novelId}.json`);
                            fs.writeFileSync(cacheFile, decompressedText);
                            splitNovelToChunks(novelId, parseData);
                        } catch (cacheErr) {
                            console.error('Lỗi lưu cache cục bộ:', cacheErr);
                        }
                    }
                } catch (e) {
                    console.error('Lỗi giải nén metadata từ body:', e);
                }

                await uploadToReadingRoom(novelId, metadata, contentBytes);
                triggerAutoClassifyServer(novelId, metadata);
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

                triggerAutoClassifyServer(novelId, metadata);
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

                triggerAutoClassifyServer(novelId, metadata);
                return NextResponse.json({ success: true, finalized: true });
            }

            return NextResponse.json({ success: true, chunkIndex });
        }

        if (action === 'edit_metadata') {
            const novelId = searchParams.get('novelId') || searchParams.get('id');
            if (!novelId) return NextResponse.json({ error: 'Missing novelId' }, { status: 400 });

            const content = await req.text();
            let newTitle: string | undefined = undefined;
            let newDescription: string | undefined = undefined;
            let newGenres: string[] | undefined = undefined;
            let forceAutoClassify = false;
            try {
                const b = JSON.parse(content);
                newTitle = b.newTitle;
                newDescription = b.newDescription;
                newGenres = b.newGenres;
                forceAutoClassify = !!b.forceAutoClassify;
            } catch {
                return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            }

            const admins = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com", "test@example.com"];
            const isUserAdmin = admins.includes(user.email || '');

            if (forceAutoClassify) {
                const { data: settingsData } = await supabase
                    .from("app_settings")
                    .select("key, value");

                const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
                    acc[curr.key] = curr.value;
                    return acc;
                }, {});

                const proxyUrlRaw = settingsMap["admin_proxy_url"];
                const proxyKey = settingsMap["admin_proxy_key"];
                const rawModel = settingsMap["admin_classify_model"] || "gemini-2.5-flash-search";

                if (!proxyUrlRaw) {
                    return NextResponse.json({ error: 'Chưa cấu hình API URL.' }, { status: 400 });
                }

                let title = newTitle || "";
                let description = newDescription || "";

                if (!title || !description) {
                    const index = await getReadingRoomIndex();
                    const meta = index.find(n => n.id === novelId);
                    if (meta) {
                        if (!title) title = meta.title;
                        if (!description) description = meta.description || "";
                    }
                }

                try {
                    const detectedGenres = await classifyNovelAI(novelId, title, description, proxyUrlRaw, proxyKey || "", rawModel, user.id, isUserAdmin);
                    return NextResponse.json({ success: true, genres: detectedGenres });
                } catch (err: any) {
                    return NextResponse.json({ error: `Phân loại tự động thất bại: ${err.message}` }, { status: 550 });
                }
            }

            const { editMetadataInReadingRoom } = await import('@/lib/google-drive-admin-v2');
            try {
                await editMetadataInReadingRoom(novelId, newTitle || '', newDescription, user.id, newGenres, isUserAdmin);
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
            const admins = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com", "test@example.com"];
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
                return NextResponse.json({ error: err.message }, { status: 550 });
            }
        }

        if (action === 'batch_classify') {
            const admins = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com", "test@example.com"];
            if (!admins.includes(user.email || '')) {
                return NextResponse.json({ error: 'Unauthorized. Chỉ dành cho Admin.' }, { status: 403 });
            }

            const index = await getReadingRoomIndex();
            const targetNovels = index.filter(n => !n.genres || n.genres.length === 0);

            let classifiedCount = 0;
            const { editMetadataInReadingRoom } = await import('@/lib/google-drive-admin-v2');

            const { data: settingsData } = await supabase
                .from("app_settings")
                .select("key, value");

            const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
                acc[curr.key] = curr.value;
                return acc;
            }, {});

            const proxyUrlRaw = settingsMap["admin_proxy_url"];
            const proxyKey = settingsMap["admin_proxy_key"];
            const rawModel = settingsMap["admin_classify_model"] || "gemini-2.5-flash-search";

            const novelId = searchParams.get('novelId');
            if (novelId) {
                const novel = index.find(n => n.id === novelId);
                if (!novel) return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
                const genres = await classifyNovelAI(
                    novel.id,
                    novel.title,
                    novel.description || "",
                    proxyUrlRaw,
                    proxyKey || "",
                    rawModel,
                    user.id,
                    true
                );
                return NextResponse.json({ success: true, genres });
            }

            const novelsToProcess = targetNovels.slice(0, 10);

            for (const novel of novelsToProcess) {
                try {
                    await classifyNovelAI(
                        novel.id,
                        novel.title,
                        novel.description || "",
                        proxyUrlRaw,
                        proxyKey || "",
                        rawModel,
                        user.id,
                        true
                    );
                    classifiedCount++;
                } catch (err) {
                    console.error(`Failed to batch-classify novel ${novel.id}:`, err);
                }
            }

            return NextResponse.json({ success: true, classifiedCount });
        }

        if (action === 'save_classify_config') {
            const admins = ["nthanhnam2005@gmail.com", "thanhxnam2005@gmail.com", "test@example.com"];
            if (!admins.includes(user.email || '')) {
                return NextResponse.json({ error: 'Unauthorized. Chỉ dành cho Admin.' }, { status: 403 });
            }

            const body = await req.json();
            const { proxyUrl, apiKey, model } = body;

            const { createClient: createAdminClient } = await import("@supabase/supabase-js");
            const adminDb = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            );

            if (proxyUrl !== undefined) {
                const cleanUrl = String(proxyUrl).trim().replace(/[^\x20-\x7E]/g, '');
                await adminDb
                    .from("app_settings")
                    .upsert({ key: "admin_proxy_url", value: cleanUrl }, { onConflict: "key" });
            }

            if (apiKey !== undefined && apiKey !== "••••••••••••" && apiKey.trim() !== "") {
                const cleanKey = String(apiKey).trim().replace(/[^\x20-\x7E]/g, '');
                await adminDb
                    .from("app_settings")
                    .upsert({ key: "admin_proxy_key", value: cleanKey }, { onConflict: "key" });
            }

            if (model !== undefined) {
                const cleanModel = String(model).trim().replace(/[^\x20-\x7E]/g, '');
                await adminDb
                    .from("app_settings")
                    .upsert({ key: "admin_classify_model", value: cleanModel }, { onConflict: "key" });
            }

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        console.error('Reading Room POST Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// Background auto classification helper running client-agnostically on the server context
async function triggerAutoClassifyServer(novelId: string, metadata: ReadingRoomMetadata) {
    if (metadata.genres && metadata.genres.length > 0) {
        return;
    }

    try {
        const supabase = await createClient();
        const { data: settingsData } = await supabase
            .from("app_settings")
            .select("key, value");

        const settingsMap = (settingsData || []).reduce((acc: any, curr: any) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});

        const autoEnabled = settingsMap["admin_auto_classify_new_novels"] === "true";
        if (!autoEnabled) return;

        const proxyUrlRaw = settingsMap["admin_proxy_url"];
        const proxyKey = settingsMap["admin_proxy_key"];
        const autoModel = settingsMap["admin_classify_model"] || "gemini-2.5-flash-search";
        if (!proxyUrlRaw || !proxyKey) return;

        let proxyUrl = proxyUrlRaw.trim().replace(/[^\x20-\x7E]/g, '');
        if (!proxyUrl.includes("/chat/completions")) {
            proxyUrl = proxyUrl.replace(/\/+$/, "") + "/chat/completions";
        }

        // Fire asynchronous deferred task (3 seconds wait)
        setTimeout(async () => {
            try {
                let description = metadata.description || "";
                let mottruyenGenre = "";
                let mottruyenIntro = "";

                if (novelId.startsWith("mottruyen-")) {
                    try {
                        const storyId = novelId.replace("mottruyen-", "");
                        const mtRes = await fetch(`http://api.mottruyen.com/story/?story_id=${storyId}`, {
                            signal: AbortSignal.timeout(6000)
                        });
                        if (mtRes.ok) {
                            const mtData = await mtRes.json();
                            if (mtData && mtData.success === 1 && mtData.data) {
                                mottruyenGenre = mtData.data.KIND || "";
                                mottruyenIntro = mtData.data.INTRO || "";
                            }
                        }
                    } catch (e) {
                        console.error("Mottruyen metadata query failed inside server side upload logic", e);
                    }
                }

                const finalDesc = description || mottruyenIntro || "";
                const mottruyenContext = mottruyenGenre ? `\n\nTHỂ LOẠI GỐC (từ nguồn Mottruyen): ${mottruyenGenre}` : "";

                const CATEGORY_GROUPS: Record<string, string[]> = {
                    "Thể loại": [
                        "Tiên Hiệp", "Huyền Huyễn", "Khoa Huyễn", "Võng Du", "Đô Thị", "Đồng Nhân", "Dã Sử", "Cạnh Kỹ", "Huyền Nghi", "Kiếm Hiệp", "Kỳ Ảo", "Light Novel", "Hiện Đại Ngôn Tình", "Huyền Huyễn Ngôn Tình", "Tiên Hiệp Kỳ Duyên", "Cổ Đại Ngôn Tình", "Huyền Nghi Thần Quái", "Khoa Huyễn Không Gian", "Lãng Mạn Thanh Xuân"
                    ],
                    "Tính cách": [
                        "Điềm Đạm", "Nhiệt Huyết", "Vô Sỉ", "Thiết Huyết", "Nhẹ Nhàng", "Cơ Trí", "Lãnh Khốc", "Kiêu Ngạo", "Ngu Ngốc"
                    ],
                    "Bối cảnh": [
                        "Đông Phương Huyền Huyễn", "Dị Thế Đại Lục", "Vương Triều Tranh Bá", "Cao Võ Thế Giới", "Tây Phương Kỳ Huyễn", "Hiện Đại Ma Pháp", "Hắc Ám Huyền Tưởng", "Lịch Sử Thần Thoại", "Võ Hiệp Huyền Tưởng", "Cổ Võ Tương Lai", "Tu Chân Văn Minh", "Huyền Tưởng Tu Tiên", "Hiện Đại Tu Chân", "Thần Thoại Tu Chân", "Cổ Điển Tiên Hiệp", "Viễn Cổ Hồng Hoang", "Đô Thị Sinh Hoạt", "Đô Thị Dị Năng", "Thanh Xuân Vườn Trường", "Ngu Nhạc Minh Tinh", "Thương Chiến Chức Tràng", "Giả Không Lịch Sử", "Lịch Sử Quân Sự", "Dân Gian Truyền Thuyết", "Lịch Sử Quan Trường", "Hư Nghĩ Võng Du", "Du Hí Dị Giới", "Điện Tử Cạnh Kỹ", "Thể Dục Cạnh Kỹ", "Cổ Võ Cơ Giáp", "Thế Giới Tương Lai", "Tinh Tế Văn Minh", "Tiến Hóa Biến Di", "Mạt Thế Nguy Cơ", "Thời Không Xuyên Toa", "Quỷ Bí Huyền Nghi", "Kỳ Diệu Thế Giới", "Trinh Thám Thôi Lý", "Thám Hiểm Sinh Tồn", "Cung Vi Trạch Đấu", "Kinh Thương Chủng Điền", "Tiên Lữ Kỳ Duyên", "Hào Môn Thế Gia", "Dị Tộc Luyến Tình", "Ma Pháp Huyền Tình", "Tinh Tế Luyến Ca", "Linh Khí Khôi Phục", "Chư Thiên Vạn Giới", "Nguyên Sinh Huyền Tưởng", "Yêu Đương Thường Ngày", "Diễn Sinh Đồng Nhân", "Cáo Tiểu Thổ Tào"
                    ],
                    "Lưu phái": [
                        "Hệ Thống", "Lão Gia", "Bàn Thờ", "Tùy Thân", "Phàm Nhân", "Vô Địch", "Xuyên Qua", "Nữ Cường", "Khế Ước", "Trọng Sinh", "Hồng Lâu", "Học Viện", "Biến Thân", "Cổ Ngu", "Chuyển Thế", "Xuyên Sách", "Đàn Xuyên", "Phế Tài", "Dưỡng Thành", "Cơm Mềm", "Vô Hạn", "Mary Sue", "Cá Mặn", "Xây Dựng Thế Lực", "Xuyên Nhanh", "Nữ Phụ", "Vả Mặt", "Sảng Văn", "Xuyên Không", "Ngọt Sủng", "Ngự Thú", "Điền Viên", "Toàn Dân", "Mỹ Thực", "Phản Phái", "Sau Màn", "Thiên Tài"
                    ]
                };
                const STANDARD_GENRES = Object.values(CATEGORY_GROUPS).flat();
                const genreListStr = STANDARD_GENRES.join(", ");

                const sysPrompt = `Bạn là một chuyên gia phân loại thể loại tiểu thuyết mạng. Hãy phân loại thể loại cho bộ truyện dựa vào tên và mô tả. Chọn tối đa 1 đến 4 thể loại KHỚP NHẤT từ danh sách sau: ${genreListStr}.`;
                const usrPrompt = `Tên truyện: ${metadata.title}\nMô tả:\n${finalDesc}${mottruyenContext}\n\nTrả về DUY NHẤT một mảng JSON các chuỗi tương ứng với các thể loại được chọn, không giải thích gì thêm, ví dụ: ["Huyền huyễn", "Hệ thống"].`;

                const apiRes = await fetch(proxyUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${proxyKey}`
                    },
                    body: JSON.stringify({
                        model: autoModel,
                        messages: [
                            { role: "system", content: sysPrompt },
                            { role: "user", content: usrPrompt }
                        ],
                        temperature: 0.1
                    })
                });

                if (apiRes.ok) {
                    const resJson = await apiRes.json();
                    const text = resJson.choices?.[0]?.message?.content || "";
                    let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
                    const startIdx = cleaned.indexOf("[");
                    const endIdx = cleaned.lastIndexOf("]");
                    if (startIdx !== -1 && endIdx !== -1) {
                        cleaned = cleaned.substring(startIdx, endIdx + 1);
                    }
                    const parsed = JSON.parse(cleaned);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const newGenres = parsed.map((s: any) => String(s).trim()).filter(Boolean);

                        const { editMetadataInReadingRoom } = await import('@/lib/google-drive-admin-v2');
                        await editMetadataInReadingRoom(novelId, metadata.title, finalDesc, 'server-auto', newGenres, true);

                        const cacheFile = path.join(os.tmpdir(), 'novel-studio-reading-room', `${novelId}.json`);
                        if (fs.existsSync(cacheFile)) {
                            fs.unlinkSync(cacheFile);
                        }
                    }
                }
            } catch (innerErr) {
                console.error("Failed to run background auto-classify server execution:", innerErr);
            }
        }, 3000);
    } catch (e) {
        console.error("Failed to retrieve settings for background auto-classify:", e);
    }
}
