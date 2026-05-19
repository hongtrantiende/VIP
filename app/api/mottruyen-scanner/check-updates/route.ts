/**
 * API Route: Check for new chapters on Mottruyen novels already in the library.
 *
 * POST /api/mottruyen-scanner/check-updates
 * Body: { novelIds: [{ localId: "mottruyen-123", mottruyenId: 123, localChapterCount: 50 }] }
 *
 * Returns which novels have new chapters available for download.
 */

import { NextResponse } from "next/server";

export const maxDuration = 60;

interface NovelCheckItem {
    localId: string;
    mottruyenId: number;
    localChapterCount: number;
}

export async function POST(req: Request) {
    try {
        const { novelIds } = (await req.json()) as { novelIds: NovelCheckItem[] };

        if (!Array.isArray(novelIds) || novelIds.length === 0) {
            return NextResponse.json({ error: "novelIds array required" }, { status: 400 });
        }

        // Check each novel's latest chapter count from the Mottruyen API
        const BATCH_SIZE = 20;
        const results: Array<{
            localId: string;
            mottruyenId: number;
            title: string;
            localChapterCount: number;
            remoteChapterCount: number;
            newChapters: number;
            chapterIds: string[];
            coverImage: string;
        }> = [];

        for (let i = 0; i < novelIds.length; i += BATCH_SIZE) {
            const batch = novelIds.slice(i, i + BATCH_SIZE);

            const promises = batch.map(async (item) => {
                try {
                    const res = await fetch(
                        `http://api.mottruyen.com/story/?story_id=${item.mottruyenId}`,
                        { signal: AbortSignal.timeout(10000) }
                    );
                    const data = await res.json();

                    if (data?.success === 1 && data.data) {
                        const remoteTotal = parseInt(data.data.TOTALCHAPTER || "0");
                        const newCount = remoteTotal - item.localChapterCount;

                        if (newCount > 0) {
                            // Collect ALL chapter IDs from the API response
                            const allChapterIds: string[] = Array.isArray(data.data.CHAPTER)
                                ? data.data.CHAPTER.map((ch: any) => String(ch?.id ?? "").trim()).filter(Boolean)
                                : [];

                            results.push({
                                localId: item.localId,
                                mottruyenId: item.mottruyenId,
                                title: data.data.NAME || "Unknown",
                                localChapterCount: item.localChapterCount,
                                remoteChapterCount: remoteTotal,
                                newChapters: newCount,
                                chapterIds: allChapterIds,
                                coverImage: data.data.IMG || "",
                            });
                        }
                    }
                } catch {
                    // Skip failed checks
                }
            });

            await Promise.all(promises);
        }

        // Sort by number of new chapters (most first)
        results.sort((a, b) => b.newChapters - a.newChapters);

        return NextResponse.json({
            success: true,
            updatable: results,
            totalChecked: novelIds.length,
            totalWithUpdates: results.length,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
