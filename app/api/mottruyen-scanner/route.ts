import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SAVE_DIR = path.join(process.cwd(), "downloads", "mottruyen");

// Hàng đợi tải truyện ngầm
// @ts-ignore
if (!global.mottruyenQueue) {
    // @ts-ignore
    global.mottruyenQueue = [];
    // @ts-ignore
    global.isQueueRunning = false;
}

// @ts-ignore
if (!global.mottruyenProgress) global.mottruyenProgress = {};

const processQueue = async () => {
    // @ts-ignore
    if (global.isQueueRunning) return;
    // @ts-ignore
    global.isQueueRunning = true;
    
    // Tăng tốc độ tải song song lên 100 truyện cùng lúc theo yêu cầu
    // @ts-ignore
    const CONCURRENCY = global.mottruyenConcurrency || 100;
    
    // @ts-ignore
    while (global.mottruyenQueue.length > 0) {
        // @ts-ignore
        const batch = global.mottruyenQueue.splice(0, CONCURRENCY);
        await Promise.all(batch.map((task: any) => task()));
    }
    
    // @ts-ignore
    global.isQueueRunning = false;
};

const downloadNovelTask = async (id: number, data: any) => {
    try {
        const novelName = data.data.NAME;
        const author = data.data.AUTHOR || "Unknown";
        let currentChapId = data.data.CHAPTER[0].id;
        
        const totalChap = parseInt(data.data.TOTALCHAPTER || "0");
        
        // @ts-ignore
        global.mottruyenProgress[id] = { name: novelName, downloaded: 0, total: totalChap, status: "fetching" };

        const novelData = {
            id: `mottruyen-${id}`,
            title: novelName,
            author: author,
            coverUrl: data.data.IMG || "",
            description: data.data.DESC || "",
            sourceUrl: `http://api.mottruyen.com/story/?story_id=${id}`,
            createdAt: new Date().toISOString(),
            chapters: [] as any[]
        };

        let chapCount = 0;

        while (currentChapId) {
            try {
                const chapRes = await fetch(`http://api.mottruyen.com/chapter/?chapter_id=${currentChapId}`, {
                    signal: AbortSignal.timeout(15000)
                });
                if (!chapRes.ok) break;
                
                const chapData = await chapRes.json();
                
                if (chapData && chapData.success === 1 && chapData.data) {
                    const chapName = chapData.data.ENAME || `Chương ${chapCount + 1}`;
                    let chapContent = chapData.data.CONTENT || "";
                    chapContent = chapContent.replace(/<p>/g, "").replace(/<\/p>/g, "\n\n").replace(/&nbsp;/g, " ").replace(/<br\s*\/?>/g, "\n");
                    
                    novelData.chapters.push({
                        id: `chap-${currentChapId}`,
                        title: chapName,
                        content: chapContent.trim(),
                        orderIndex: chapCount
                    });
                    
                    chapCount++;
                    currentChapId = chapData.data.NEXT; 
                    
                    // @ts-ignore
                    if (global.mottruyenProgress[id]) {
                        // @ts-ignore
                        global.mottruyenProgress[id].downloaded = chapCount;
                    }

                    await new Promise(r => setTimeout(r, 500));
                } else {
                    break;
                }
            } catch (e) {
                console.error(`Lỗi khi tải chương ${currentChapId} của truyện ID ${id}`);
                break; 
            }
        }

        const safeName = novelName.replace(/[\\/*?:"<>|]/g, "");
        fs.writeFileSync(path.join(SAVE_DIR, `[${id}]_${safeName}.json`), JSON.stringify(novelData, null, 2));
        
        // @ts-ignore
        if (global.mottruyenProgress[id]) {
            // @ts-ignore
            global.mottruyenProgress[id].status = "done";
        }
    } catch (err) {
        // @ts-ignore
        if (global.mottruyenProgress && global.mottruyenProgress[id]) {
            // @ts-ignore
            global.mottruyenProgress[id].status = "error";
        }
    }
};

export async function POST(req: Request) {
    try {
        const { startId, batchSize } = await req.json();
        
        // Cập nhật số luồng tải song song từ giao diện
        // @ts-ignore
        global.mottruyenConcurrency = batchSize > 0 ? batchSize : 100;

        if (!startId || !batchSize) {
            return NextResponse.json({ error: "Missing startId or batchSize" }, { status: 400 });
        }

        if (!fs.existsSync(SAVE_DIR)) {
            fs.mkdirSync(SAVE_DIR, { recursive: true });
        }

        const fetchStory = async (id: number) => {
            try {
                // 1. Lấy thông tin metadata của truyện
                const res = await fetch(`http://api.mottruyen.com/story/?story_id=${id}`, {
                    signal: AbortSignal.timeout(15000)
                });
                if (!res.ok) return { id, success: false };
                
                const data = await res.json();
                
                // Nếu api trả về success: 1 nghĩa là ID này tồn tại truyện
                if (data && data.success === 1 && data.data && data.data.CHAPTER && data.data.CHAPTER.length > 0) {
                    // Thêm vào hàng đợi tải ngầm
                    // @ts-ignore
                    global.mottruyenQueue.push(() => downloadNovelTask(id, data));
                    
                    // Kích hoạt worker nếu chưa chạy
                    processQueue();
                    
                    return { id, success: true };
                }
                
                return { id, success: false };
            } catch (err) {
                return { id, success: false };
            }
        };

        // Chạy song song Batch Size bộ truyện
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
            promises.push(fetchStory(startId + i));
        }

        const results = await Promise.all(promises);
        const successCount = results.filter(r => r.success).length;

        return NextResponse.json({ success: true, successCount, total: batchSize });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
