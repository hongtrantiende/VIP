import { NextResponse } from "next/server";
import { getReadingRoomIndex } from "@/lib/google-drive-admin-v2";

export const maxDuration = 60; // seconds

export async function POST(req: Request) {
    try {
        const { startId, batchSize, categoryFilter } = await req.json();

        if (!startId || !batchSize) {
            return NextResponse.json({ error: "Missing startId or batchSize" }, { status: 400 });
        }

        // Lấy index phòng đọc
        const rrIndex = await getReadingRoomIndex();

        const fetchPromises = [];
        for (let i = startId; i < startId + batchSize; i++) {
            fetchPromises.push(
                fetch(`http://api.mottruyen.com/story/?story_id=${i}`, {
                    signal: AbortSignal.timeout(10000)
                })
                    .then(res => res.json())
                    .then(data => {
                        if (data && data.success === 1 && data.data && data.data.CHAPTER && data.data.CHAPTER.length > 0) {
                            // Lọc bỏ truyện không có ảnh bìa hoặc dùng ảnh placeholder
                            const img = (data.data.IMG || "").trim();
                            if (!img || img.includes("poster//150.jpg") || img.includes("poster//0.jpg")) {
                                return null; // Bỏ qua truyện không có ảnh bìa
                            }

                            // Lọc theo thể loại nếu được cấu hình
                            if (categoryFilter && categoryFilter.trim() !== "") {
                                const genres = (data.data.KIND || "").toLowerCase();
                                const filterLower = categoryFilter.toLowerCase();
                                if (!genres.includes(filterLower)) {
                                    return null; // Bỏ qua nếu không khớp thể loại
                                }
                            }

                            const totalChap = parseInt(data.data.TOTALCHAPTER || "0");
                            const novelIdStr = `mottruyen-${i}`;
                            const existingInRR = rrIndex.find((n: any) => n.id === novelIdStr);

                            if (existingInRR) {
                                return null; // Bỏ qua hoàn toàn nếu đã có trong phòng đọc
                            }

                            return {
                                id: i,
                                novelData: data.data,
                                existingInRR: existingInRR || null
                            };
                        }
                        return null;
                    })
                    .catch(() => null)
            );
        }

        const results = await Promise.all(fetchPromises);
        const validNovels = results.filter(r => r !== null);

        return NextResponse.json({
            success: true,
            validNovels,
            totalScanned: batchSize
        });

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
