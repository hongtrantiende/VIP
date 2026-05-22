"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
    GlobeIcon, DownloadIcon, PlayIcon, PauseIcon,
    XCircleIcon, CheckCircle2Icon, AlertTriangleIcon, Loader2Icon,
    RefreshCwIcon, ZapIcon, StopCircleIcon
} from "lucide-react";
import { useProfile } from "@/lib/hooks/use-profile";
import { useBulkScraperStore } from "@/lib/stores/bulk-scraper-queue";
import { db } from "@/lib/db";
import { toast } from "sonner";
import { redirect } from "next/navigation";
import { compress } from "@/lib/compression";
import { useMottruyenStore, mottruyenGlobalRefs } from "@/lib/stores/mottruyen-scraper";

const DEFAULT_URL = "https://truyenfull.today";

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
    pending: { label: "Chờ", icon: PauseIcon, color: "text-muted-foreground" },
    "fetching-info": { label: "Quét chương", icon: Loader2Icon, color: "text-blue-500" },
    scraping: { label: "Đang tải", icon: DownloadIcon, color: "text-yellow-500" },
    done: { label: "Xong", icon: CheckCircle2Icon, color: "text-green-500" },
    error: { label: "Lỗi", icon: AlertTriangleIcon, color: "text-red-500" },
    cancelled: { label: "Đã hủy", icon: XCircleIcon, color: "text-gray-400" },
};

export default function BulkScraperPage() {
    const { isAdmin, loading: profileLoading } = useProfile();
    const store = useBulkScraperStore();

    // Admin guard
    if (!profileLoading && !isAdmin) {
        redirect("/");
    }

    const activeJobs = store.jobs.filter(
        (j) => ["pending", "fetching-info", "scraping"].includes(j.status)
    );
    const finishedJobs = store.jobs.filter(
        (j) => ["done", "error", "cancelled"].includes(j.status)
    );

    const [targetUrl, setTargetUrl] = React.useState(DEFAULT_URL);

    const handleStart = () => {
        store.startAutoScan(targetUrl);
        toast.success(`Bắt đầu quét tự động ${new URL(targetUrl).hostname} — 5 luồng song song`);
    };

    if (profileLoading) {
        return (
            <div className="flex-1 p-6 space-y-6 animate-page-enter">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-[400px] rounded-xl" />
            </div>
        );
    }

    return (
        <div className="flex-1 p-6 space-y-6 animate-page-enter">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 w-full">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 shrink-0">
                        <GlobeIcon className="size-5 text-violet-500" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-lg sm:text-xl font-bold">Quét Website Tự Động</h1>
                        <p className="text-[10px] sm:text-xs text-muted-foreground break-words truncate max-w-[200px] sm:max-w-none">
                            Tự động quét & tải song song 5 bộ từ {DEFAULT_URL}
                        </p>
                    </div>
                    <Badge variant="secondary" className="ml-auto text-[10px] uppercase font-bold shrink-0">
                        Admin Only
                    </Badge>
                </div>
            </div>

            {/* Control Panel */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-sm">Quét Tự Động</CardTitle>
                            <CardDescription className="text-xs">
                                {store.phase === "idle" && "Bấm bắt đầu để quét toàn bộ website tự động"}
                                {store.phase === "running" && (
                                    <>
                                        Đang quét trang {store.currentPage} •{" "}
                                        {store.completedCount} xong / {store.failedCount > 0 ? `${store.failedCount} lỗi / ` : ""}
                                        {store.totalScanned} đã quét •{" "}
                                        {activeJobs.length} đang tải
                                    </>
                                )}
                                {store.phase === "paused" && `Tạm dừng — ${store.completedCount} xong, ${activeJobs.length} đang tải`}
                                {store.phase === "finished" && (
                                    <>
                                        Hoàn tất! {store.completedCount} bộ đã tải, {store.failedCount} lỗi
                                        {store.siteExhausted && " — Hết truyện trên website"}
                                    </>
                                )}
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2 w-full lg:w-auto">
                            {store.phase === "idle" && (
                                <div className="flex sm:items-center gap-2 flex-col sm:flex-row w-full lg:w-auto">
                                    <Input
                                        value={targetUrl}
                                        onChange={(e) => setTargetUrl(e.target.value)}
                                        placeholder="Nhập URL (hoặc wikicv.net...)"
                                        className="w-full sm:w-56 h-9"
                                    />
                                    <Button
                                        onClick={handleStart}
                                        className="bg-gradient-to-r from-violet-600 to-purple-600 text-white w-full sm:w-auto mt-2 sm:mt-0"
                                    >
                                        <ZapIcon className="size-4 mr-1.5" />
                                        Bắt đầu quét
                                    </Button>
                                </div>
                            )}
                            {store.phase === "running" && (
                                <>
                                    <Button variant="outline" size="sm" onClick={() => store.pauseAutoScan()}>
                                        <PauseIcon className="size-3.5 mr-1" />
                                        Tạm dừng
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => store.stopAutoScan()}>
                                        <StopCircleIcon className="size-3.5 mr-1" />
                                        Dừng
                                    </Button>
                                </>
                            )}
                            {store.phase === "paused" && (
                                <>
                                    <Button size="sm" onClick={() => store.resumeAutoScan()}
                                        className="bg-gradient-to-r from-violet-600 to-purple-600 text-white">
                                        <PlayIcon className="size-3.5 mr-1" />
                                        Tiếp tục
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => store.stopAutoScan()}>
                                        <StopCircleIcon className="size-3.5 mr-1" />
                                        Dừng
                                    </Button>
                                </>
                            )}
                            {store.phase === "finished" && (
                                <Button variant="outline" size="sm" onClick={() => store.reset()}>
                                    <RefreshCwIcon className="size-3.5 mr-1" />
                                    Quét lại
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>

                {/* Progress overview */}
                {store.phase !== "idle" && (
                    <CardContent className="pt-0">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                            <StatCard label="Đang tải" value={activeJobs.length} color="text-blue-500" />
                            <StatCard label="Hoàn tất" value={store.completedCount} color="text-green-500" />
                            <StatCard label="Lỗi" value={store.failedCount} color="text-red-500" />
                            <StatCard label="Trang quét" value={store.currentPage - 1} color="text-violet-500" />
                        </div>
                    </CardContent>
                )}
            </Card>

            {/* Mottruyen Scanner */}
            <div className="space-y-6">
                <MottruyenScannerCard />
                <MottruyenIdDownloaderCard />
            </div>


            {/* Active Jobs */}
            {
                activeJobs.length > 0 && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <Loader2Icon className="size-3.5 animate-spin text-blue-500" />
                                Đang tải ({activeJobs.length} luồng)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {activeJobs.map((job) => (
                                    <JobRow key={job.id} job={job} onCancel={() => store.cancelJob(job.id)} />
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )
            }

            {/* Completed Jobs */}
            {
                finishedJobs.length > 0 && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <CheckCircle2Icon className="size-3.5 text-green-500" />
                                Đã hoàn tất ({finishedJobs.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1 max-h-[400px] overflow-y-auto">
                                {finishedJobs.map((job) => (
                                    <JobRow key={job.id} job={job} compact />
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )
            }
        </div >
    );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="rounded-lg border p-3 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
    );
}

function JobRow({ job, onCancel, compact }: { job: any; onCancel?: () => void; compact?: boolean }) {
    const config = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
    const Icon = config.icon;
    const pct = job.progress.total > 0
        ? Math.round((job.progress.completed / job.progress.total) * 100)
        : 0;

    return (
        <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${job.status === "done" ? "border-green-500/20 bg-green-500/5" :
            job.status === "error" ? "border-red-500/20 bg-red-500/5" :
                job.status === "scraping" ? "border-yellow-500/20 bg-yellow-500/5" :
                    "border-border"
            }`}>
            <Icon className={`size-4 shrink-0 ${config.color} ${["scraping", "fetching-info"].includes(job.status) ? "animate-spin" : ""
                }`} />

            <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">{job.novel.title}</p>
                    <Badge variant="outline" className="text-[9px] ml-2 shrink-0">{config.label}</Badge>
                </div>

                {!compact && ["scraping", "fetching-info"].includes(job.status) && job.progress.total > 0 && (
                    <div className="space-y-0.5">
                        <Progress value={pct} className="h-1.5" />
                        <p className="text-[10px] text-muted-foreground truncate">
                            {job.progress.current} ({job.progress.completed}/{job.progress.total})
                        </p>
                    </div>
                )}

                {job.status === "done" && (
                    <p className="text-[10px] text-green-600">
                        {job.progress.total} chương đã tải
                    </p>
                )}
                {job.error && <p className="text-[10px] text-red-500 truncate">{job.error}</p>}
            </div>

            {onCancel && ["pending", "scraping", "fetching-info"].includes(job.status) && (
                <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onCancel}>
                    <XCircleIcon className="size-4 text-muted-foreground hover:text-destructive" />
                </Button>
            )}
        </div>
    );
}

const ensureNovelInDexie = async (novelIdStr: string) => {
    try {
        const existingInDb = await db.novels.get(novelIdStr);
        if (existingInDb) {
            const count = await db.chapters.where("novelId").equals(novelIdStr).count();
            if (count > 0) return true;
        }

        const res = await fetch(`/api/reading-room?action=download_full&id=${novelIdStr}`);
        if (!res.ok) return false;

        const data = await res.json();
        if (data && data.novel) {
            await db.transaction("rw", [db.novels, db.chapters, db.scenes], async () => {
                await db.novels.put(data.novel);
                if (Array.isArray(data.chapters)) {
                    await db.chapters.bulkPut(data.chapters);
                }
                if (Array.isArray(data.scenes)) {
                    await db.scenes.bulkPut(data.scenes);
                }
            });
            return true;
        }
    } catch (e) {
        console.error("Lỗi đồng bộ vào Dexie:", e);
    }
    return false;
};

const processDownloadQueue = async () => {
    const limit = mottruyenGlobalRefs.maxParallelDownloads ?? 10;
    if (mottruyenGlobalRefs.activeDownloadsCount >= limit) {
        return;
    }

    const isRunning = useMottruyenStore.getState().status === "running";
    let index = -1;
    if (isRunning) {
        index = mottruyenGlobalRefs.downloadQueue.findIndex(() => true);
    } else {
        index = mottruyenGlobalRefs.downloadQueue.findIndex(item => item.isUpdateOrFix);
    }

    if (index === -1) return;

    const novelInfo = mottruyenGlobalRefs.downloadQueue.splice(index, 1)[0];
    if (!novelInfo) return;

    mottruyenGlobalRefs.activeDownloadsCount++;
    try {
        await downloadNovelInFrontend(novelInfo, !!novelInfo.isUpdateOrFix);
        mottruyenGlobalRefs.successCount++;
        useMottruyenStore.getState().setSuccessCount(mottruyenGlobalRefs.successCount);
    } catch (e) {
        console.error("Lỗi tải truyện:", e);
    } finally {
        mottruyenGlobalRefs.activeDownloadsCount--;
        processDownloadQueue();
    }
};

const downloadNovelInFrontend = async (novelInfo: any, isUpdateOrFix: boolean = false) => {
    const { id, novelData } = novelInfo;
    const novelIdStr = `mottruyen-${id}`;
    let crawlError: Error | null = null;
    const shouldContinue = () => (useMottruyenStore.getState().status === "running" || isUpdateOrFix) && !crawlError;

    try {
        if (!isUpdateOrFix && mottruyenGlobalRefs.readingRoomIndex.has(novelIdStr)) {
            console.log(`[ID ${id}] Đã có trong Phòng Đọc, bỏ qua.`);
            return;
        }

        if (isUpdateOrFix) {
            await ensureNovelInDexie(novelIdStr);

            if (Array.isArray(novelInfo.faultyChapterIds) && novelInfo.faultyChapterIds.length > 0) {
                await db.transaction("rw", [db.chapters, db.scenes], async () => {
                    for (const chapId of novelInfo.faultyChapterIds) {
                        const dbId = `chap-${chapId}`;
                        await db.chapters.delete(dbId);
                        await db.scenes.delete(`scene-${dbId}`);
                    }
                });
            }
        }

        const totalChap = parseInt(novelData.TOTALCHAPTER || "0");

        const freshExistingInDb = await db.novels.get(novelIdStr);
        const freshExistingChapters = freshExistingInDb
            ? await db.chapters.where("novelId").equals(novelIdStr).toArray()
            : [];

        let downloadedCount = freshExistingChapters.length;

        useMottruyenStore.getState().setProgressData(prev => ({
            ...prev,
            [id]: { name: novelData.NAME, downloaded: downloadedCount, total: totalChap, status: "fetching" }
        }));

        let extractedGenres: string[] = [];
        if (typeof novelData.KIND === 'string' && novelData.KIND.trim() !== '') {
            extractedGenres = novelData.KIND.split(/[,;\-]/).map((k: string) => k.trim()).filter(Boolean);
        }
        const resolvedGenres = extractedGenres.length > 0 ? extractedGenres : (freshExistingInDb?.genres || []);

        if (id === "899" || id === 899) {
            toast(`Thể loại gốc: "${novelData.KIND}" => Mảng: ${JSON.stringify(resolvedGenres)}`);
        }

        let cleanedTitle = novelData.NAME || "";
        let cleanedDesc = (novelData.DESC || "").replace(/<[^>]*>?/gm, '').trim();
        try {
            const parser = new DOMParser();
            cleanedTitle = parser.parseFromString(cleanedTitle, "text/html").documentElement.textContent || cleanedTitle;
            cleanedDesc = parser.parseFromString(cleanedDesc, "text/html").documentElement.textContent || cleanedDesc;
        } catch (e) { }

        let novelObj = freshExistingInDb ? {
            ...freshExistingInDb,
            title: cleanedTitle,
            description: cleanedDesc,
            genres: resolvedGenres,
            genre: novelData.KIND || freshExistingInDb.genre || "",
            wrongChaptersCount: 0,
            reviewIssues: []
        } : {
            id: novelIdStr,
            title: cleanedTitle,
            author: novelData.AUTHOR || "Unknown",
            coverImage: novelData.IMG || "",
            description: cleanedDesc,
            genres: resolvedGenres,
            genre: novelData.KIND || "",
            sourceUrl: `http://api.mottruyen.com/story/?story_id=${id}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            wrongChaptersCount: 0,
            reviewIssues: []
        };

        await db.novels.put(novelObj);

        const alreadyFetchedChapterIds = new Set(
            freshExistingChapters.map(ch => ch.id.replace("chap-", ""))
        );

        const queue: string[] = [];

        if (isUpdateOrFix && Array.isArray(novelInfo.faultyChapterIds) && novelInfo.faultyChapterIds.length > 0) {
            queue.push(...novelInfo.faultyChapterIds);
        }

        if (queue.length === 0 && freshExistingChapters.length > 0) {
            const sorted = [...freshExistingChapters].sort((a, b) => b.order - a.order);
            const latestChap = sorted[0];
            const latestChapId = latestChap.id.replace("chap-", "");
            alreadyFetchedChapterIds.delete(latestChapId);
            queue.push(latestChapId);
        }

        if (queue.length === 0) {
            let initialChapterIds: string[] = Array.isArray(novelData.CHAPTER)
                ? novelData.CHAPTER
                    .map((ch: any) => String(ch?.id ?? "").trim())
                    .filter((id: string) => id.length > 0)
                : [];
            queue.push(...initialChapterIds.filter(cId => !alreadyFetchedChapterIds.has(cId)));
        }

        if (queue.length === 0) {
            useMottruyenStore.getState().setProgressData(prev => ({ ...prev, [id]: { ...prev[id], status: "done" } }));
            return;
        }

        const processed = new Set<string>([...alreadyFetchedChapterIds]);
        let activeCount = 0;
        const CONCURRENCY = 15;

        let lastUiUpdate = Date.now();

        const fetchAndStore = async (cId: string) => {
            if (processed.has(cId) || !shouldContinue()) return;
            processed.add(cId);
            activeCount++;

            try {
                const proxyUrl = encodeURIComponent(`http://api.mottruyen.com/chapter/?chapter_id=${cId}`);

                let chapData;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        const chapRes = await fetch(`/api/mottruyen-proxy?url=${proxyUrl}`);
                        if (!chapRes.ok) {
                            throw new Error(`Fetch failed with status ${chapRes.status}`);
                        }
                        chapData = await chapRes.json();
                        if (chapData?.error) {
                            throw new Error(`Proxy error: ${chapData.error}`);
                        }
                        break;
                    } catch (err: any) {
                        if (attempt === 3) throw err;
                        await new Promise(r => setTimeout(r, attempt * 1000));
                    }
                }

                if (!chapData) throw new Error("Failed to load and parse chapter data after retries");

                if (chapData.success === 1 && chapData.data) {
                    const data = chapData.data;

                    let chapName = data.ENAME || `Chương ${data.ORDER || "?"}`;
                    try {
                        chapName = new DOMParser().parseFromString(chapName, "text/html").documentElement.textContent || chapName;
                    } catch (e) { }

                    let chapContent = data.CONTENT || "";
                    chapContent = chapContent.replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");

                    try {
                        chapContent = new DOMParser().parseFromString(chapContent, "text/html").documentElement.textContent || chapContent;
                    } catch (e) { }

                    chapContent = chapContent.split('\n')
                        .map((l: string) => l.trim())
                        .filter((line: string) => {
                            if (!line) return false;
                            const lower = line.toLowerCase();
                            const blacklist = ["người đăng", "thời gian đổi mới", "thời gian cập nhật", "cầu nguyệt phiếu", "nhóm dịch", "mới đọc giả", "mottruyen.com"];
                            return !blacklist.some(b => lower.includes(b));
                        }).join('\n\n').trim();

                    let order = parseInt(data.ORDER || "0");
                    if (data.ENAME) {
                        const match = data.ENAME.match(/\(#(\d+)\)/);
                        if (match) {
                            order = parseInt(match[1]);
                        }
                    }
                    const dbId = `chap-${cId}`;
                    const now = new Date();

                    await Promise.all([
                        db.chapters.put({
                            id: dbId,
                            novelId: novelObj.id,
                            title: chapName,
                            order: order,
                            createdAt: now,
                            updatedAt: now,
                        }),
                        db.scenes.put({
                            id: `scene-${dbId}`,
                            novelId: novelObj.id,
                            chapterId: dbId,
                            title: "",
                            content: chapContent,
                            wordCount: chapContent.split(/\s+/).length,
                            order: 0,
                            version: 1,
                            versionType: "manual" as any,
                            isActive: 1,
                            createdAt: now,
                            updatedAt: now,
                        })
                    ]);

                    downloadedCount++;

                    if (data.NEXT && data.NEXT !== "0" && !processed.has(data.NEXT)) {
                        queue.push(data.NEXT);
                    }
                    if (data.PREV && data.PREV !== "0" && !processed.has(data.PREV)) {
                        queue.push(data.PREV);
                    }

                    if (Date.now() - lastUiUpdate > 1000) {
                        useMottruyenStore.getState().setProgressData(prev => ({ ...prev, [id]: { ...prev[id], downloaded: downloadedCount } }));
                        lastUiUpdate = Date.now();
                    }
                }
            } catch (e: any) {
                console.error(`Lỗi tải chương ${cId}:`, e);
                crawlError = e;
            } finally {
                activeCount--;
            }
        };

        const workers = Array.from({ length: CONCURRENCY }, async () => {
            while (shouldContinue()) {
                const cId = queue.shift();
                if (cId) {
                    await fetchAndStore(cId);
                } else if (activeCount > 0) {
                    await new Promise(r => setTimeout(r, 100));
                } else {
                    break;
                }
            }
        });
        await Promise.all(workers);

        if (crawlError) {
            throw crawlError;
        }

        if (!shouldContinue()) {
            useMottruyenStore.getState().setProgressData(prev => ({ ...prev, [id]: { ...prev[id], status: "paused" } }));
            mottruyenGlobalRefs.downloadQueue.unshift(novelInfo);
            return;
        }

        useMottruyenStore.getState().setProgressData(prev => ({ ...prev, [id]: { ...prev[id], downloaded: downloadedCount, status: "done" } }));

        const [chapters, scenes] = await Promise.all([
            db.chapters.where("novelId").equals(novelObj.id).toArray(),
            db.scenes.where("novelId").equals(novelObj.id).toArray()
        ]);

        const sortedChapters = chapters.sort((a, b) => a.order - b.order);

        const exportData = {
            novel: await db.novels.get(novelObj.id),
            chapters: sortedChapters,
            scenes: scenes
        };

        const jsonString = JSON.stringify(exportData);
        const compressed = await compress(jsonString);

        const metadata = {
            id: novelObj.id,
            title: exportData.novel?.title || '',
            author: exportData.novel?.author || '',
            description: exportData.novel?.description || '',
            coverImage: exportData.novel?.coverImage || '',
            chapterCount: sortedChapters.length,
            genres: exportData.novel?.genres || [],
            wrongChaptersCount: exportData.novel?.reviewIssues?.length || 0,
        };

        try {
            const { uploadCompressedInChunks } = await import("@/lib/utils");
            await uploadCompressedInChunks(
                novelObj.id,
                metadata,
                compressed
            );

            mottruyenGlobalRefs.readingRoomIndex.add(novelIdStr);
            toast.success(`Đã lưu phòng đọc: ${novelObj.title} (${downloadedCount} ch)`);
            await Promise.all([
                db.scenes.where("novelId").equals(novelObj.id).delete(),
                db.chapters.where("novelId").equals(novelObj.id).delete(),
                db.novels.delete(novelObj.id)
            ]);

            useMottruyenStore.getState().setProgressData(prev => {
                const newData = { ...prev };
                delete newData[id];
                return newData;
            });
        } catch (uploadErr: any) {
            toast.error(`Lỗi upload phòng đọc: ${novelObj.title} - ${uploadErr.message}`);
        }
    } catch (err) {
        console.error("Lỗi downloadNovelInFrontend:", err);
        useMottruyenStore.getState().setProgressData(prev => ({ ...prev, [id]: { ...prev[id], status: "error" } }));
    }
};

function MottruyenScannerCard() {
    const {
        status, setStatus,
        currentId, setCurrentId,
        endId, setEndId,
        batchSize, setBatchSize,
        categoryFilter, setCategoryFilter,
        progressData, setProgressData,
        successCount, setSuccessCount,
        totalProcessed, setTotalProcessed,
        reset
    } = useMottruyenStore();

    const [startId, setStartId] = useState(currentId === 800 ? 800 : currentId);
    const [parallelLimitInput, setParallelLimitInput] = useState<string>("10");

    useEffect(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("mottruyen_parallel_limit");
            if (saved) {
                const num = parseInt(saved);
                if (!isNaN(num) && num > 0) {
                    mottruyenGlobalRefs.maxParallelDownloads = num;
                    setParallelLimitInput(String(num));
                }
            }
        }
    }, []);

    const handleSaveParallelLimit = () => {
        const val = parseInt(parallelLimitInput);
        if (isNaN(val) || val <= 0) {
            toast.error("Số lượng truyện tải song song không hợp lệ!");
            return;
        }
        if (typeof window !== "undefined") {
            localStorage.setItem("mottruyen_parallel_limit", String(val));
        }
        mottruyenGlobalRefs.maxParallelDownloads = val;
        toast.success(`Đã lưu giới hạn tải song song: ${val} truyện`);

        if (useMottruyenStore.getState().status === "running") {
            const needed = val - mottruyenGlobalRefs.activeDownloadsCount;
            for (let i = 0; i < needed; i++) {
                processDownloadQueue();
            }
        }
    };

    const runningRef = {
        get current() { return useMottruyenStore.getState().status === "running"; }
    };

    const successCountRef = {
        get current() { return mottruyenGlobalRefs.successCount; },
        set current(val) { mottruyenGlobalRefs.successCount = val; }
    };
    const totalProcessedRef = {
        get current() { return mottruyenGlobalRefs.totalProcessed; },
        set current(val) { mottruyenGlobalRefs.totalProcessed = val; }
    };
    const currentIdRef = {
        get current() { return mottruyenGlobalRefs.currentId; },
        set current(val) { mottruyenGlobalRefs.currentId = val; }
    };

    useEffect(() => {
        if (mottruyenGlobalRefs.readingRoomIndex.size > 0) return;
        fetch('/api/reading-room?action=list')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.novels) {
                    const ids = data.novels.map((n: any) => n.id);
                    mottruyenGlobalRefs.readingRoomIndex = new Set(ids);
                }
            })
            .catch(console.error);
    }, []);

    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible' && runningRef.current) {
                setSuccessCount(successCountRef.current);
                setTotalProcessed(totalProcessedRef.current);
                setCurrentId(currentIdRef.current);
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    const startScan = async () => {
        if (useMottruyenStore.getState().status === "running") return;
        if (currentId >= endId) return;
        setStatus("running");

        let cid = currentId;
        while (useMottruyenStore.getState().status === "running" && cid <= endId) {
            if (mottruyenGlobalRefs.downloadQueue.length >= batchSize * 2) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            try {
                const res = await fetch("/api/mottruyen-scanner", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ startId: cid, batchSize: Math.min(batchSize, endId - cid + 1), categoryFilter })
                });

                if (res.ok) {
                    const data = await res.json();

                    if (data.validNovels && data.validNovels.length > 0) {
                        mottruyenGlobalRefs.downloadQueue.push(...data.validNovels);

                        const limit = mottruyenGlobalRefs.maxParallelDownloads ?? 10;
                        for (let i = mottruyenGlobalRefs.activeDownloadsCount; i < limit; i++) {
                            processDownloadQueue();
                        }
                    }

                    mottruyenGlobalRefs.totalProcessed += data.totalScanned;
                    setTotalProcessed(mottruyenGlobalRefs.totalProcessed);
                }
            } catch (err) {
                console.error(err);
            }

            if (useMottruyenStore.getState().status !== "running") break;
            cid += batchSize;
            mottruyenGlobalRefs.currentId = cid;
            setCurrentId(cid);
        }

        if (cid > endId) {
            const waitFinish = setInterval(() => {
                if (mottruyenGlobalRefs.activeDownloadsCount === 0 && mottruyenGlobalRefs.downloadQueue.length === 0) {
                    clearInterval(waitFinish);
                    setStatus("finished");
                }
            }, 1000);
        }
    };

    const pauseScan = () => {
        setStatus("paused");
    };

    const resetScan = () => {
        reset();
        setCurrentId(startId);
    };

    // ── Kiểm tra cập nhật chương mới & Tự động cập nhật ──
    const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "done">("idle");
    const [updatableNovels, setUpdatableNovels] = useState<Array<{
        localId: string; mottruyenId: number; title: string;
        localChapterCount: number; remoteChapterCount: number;
        newChapters: number; chapterIds: string[]; coverImage: string;
    }>>([]);
    const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

    const checkForUpdates = async () => {
        setUpdateStatus("checking");
        setUpdatableNovels([]);
        try {
            const rrRes = await fetch("/api/reading-room?action=list");
            const rrData = await rrRes.json();
            const rrNovels: any[] = rrData.novels || [];

            const mottruyenNovels = rrNovels
                .filter((n: any) => n.id?.startsWith("mottruyen-"))
                .map((n: any) => ({
                    localId: n.id,
                    mottruyenId: parseInt(n.id.replace("mottruyen-", "")),
                    localChapterCount: n.chapterCount || 0,
                }))
                .filter((n) => !isNaN(n.mottruyenId));

            if (mottruyenNovels.length === 0) {
                toast("Chưa có truyện Mottruyen nào trong Phòng Đọc.");
                setUpdateStatus("done");
                return;
            }

            toast(`Đang kiểm tra ${mottruyenNovels.length} truyện Mottruyen...`);

            const res = await fetch("/api/mottruyen-scanner/check-updates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ novelIds: mottruyenNovels }),
            });

            const data = await res.json();
            if (data.success) {
                setUpdatableNovels(data.updatable || []);
                if (data.totalWithUpdates === 0) {
                    toast.success("Tất cả truyện đã cập nhật đầy đủ! ✅");
                } else {
                    toast.success(`Có ${data.totalWithUpdates} truyện cần cập nhật!`);
                    
                    toast.info(`Bắt đầu tự động tải và cập nhật ${data.totalWithUpdates} bộ truyện...`);
                    for (const novel of data.updatable) {
                        await updateNovel(novel);
                        await new Promise(r => setTimeout(r, 400));
                    }
                }
            }
        } catch (err: any) {
            toast.error("Lỗi kiểm tra: " + err.message);
        } finally {
            setUpdateStatus("done");
        }
    };

    const updateNovel = async (novel: typeof updatableNovels[0]) => {
        setUpdatingIds(prev => new Set(prev).add(novel.mottruyenId));
        try {
            const storyRes = await fetch(`/api/mottruyen-proxy?url=${encodeURIComponent(`http://api.mottruyen.com/story/?story_id=${novel.mottruyenId}`)}`);
            const storyData = await storyRes.json();
            if (storyData?.success === 1 && storyData.data) {
                mottruyenGlobalRefs.downloadQueue.push({ id: novel.mottruyenId, novelData: storyData.data, isUpdateOrFix: true });
                processDownloadQueue();
                toast.success(`Đang tải thêm ${novel.newChapters} chương mới: ${novel.title}`);

                setUpdatableNovels(prev => prev.filter(n => n.mottruyenId !== novel.mottruyenId));
            } else {
                toast.error(`Không tải được thông tin truyện ID ${novel.mottruyenId}`);
            }
        } catch (err: any) {
            toast.error(`Lỗi: ${err.message}`);
        } finally {
            setUpdatingIds(prev => { const s = new Set(prev); s.delete(novel.mottruyenId); return s; });
        }
    };

    // ── Quét lỗi & Sửa lỗi truyện trong Phòng Đọc ──
    const [errorScanStatus, setErrorScanStatus] = useState<"idle" | "scanning" | "done">("idle");
    const [errorProgress, setErrorProgress] = useState({ current: 0, total: 0 });
    const [errorScanLog, setErrorScanLog] = useState<string[]>([]);

    const scanReadingRoomErrors = async () => {
        setErrorScanStatus("scanning");
        setErrorScanLog([]);
        setErrorProgress({ current: 0, total: 0 });
        toast.info("Bắt đầu quét lỗi các truyện Mottruyen trong phòng đọc...");

        try {
            const rrRes = await fetch("/api/reading-room?action=list");
            if (!rrRes.ok) throw new Error("Không lấy được danh sách phòng đọc");
            const rrData = await rrRes.json();
            const rrNovels: any[] = rrData.novels || [];

            const mottruyenNovels = rrNovels.filter((n: any) => n.id?.startsWith("mottruyen-"));
            if (mottruyenNovels.length === 0) {
                toast.success("Không có truyện Mottruyen nào trong phòng đọc để quét.");
                setErrorScanStatus("done");
                return;
            }

            setErrorProgress({ current: 0, total: mottruyenNovels.length });

            let fixedCount = 0;

            for (let i = 0; i < mottruyenNovels.length; i++) {
                const novel = mottruyenNovels[i];
                setErrorProgress(prev => ({ ...prev, current: i + 1 }));

                try {
                    const fullRes = await fetch(`/api/reading-room?action=download_full&id=${novel.id}`);
                    if (!fullRes.ok) {
                        setErrorScanLog(prev => [...prev, `❌ [${novel.title}] Lỗi: Không thể tải từ phòng đọc`]);
                        continue;
                    }
                    const fullData = await fullRes.json();
                    
                    const mottruyenId = novel.id.replace("mottruyen-", "");
                    const storyRes = await fetch(`/api/mottruyen-proxy?url=${encodeURIComponent(`http://api.mottruyen.com/story/?story_id=${mottruyenId}`)}`);
                    if (!storyRes.ok) {
                        setErrorScanLog(prev => [...prev, `⚠️ [${novel.title}] Không tải được thông tin từ API Mottruyen`]);
                        continue;
                    }
                    const storyData = await storyRes.json();
                    if (storyData?.success !== 1 || !storyData.data) {
                        setErrorScanLog(prev => [...prev, `⚠️ [${novel.title}] API Mottruyen trả về dữ liệu không hợp lệ`]);
                        continue;
                    }

                    const remoteChapterList = Array.isArray(storyData.data.CHAPTER) ? storyData.data.CHAPTER : [];
                    const remoteChapterIds = new Set<string>(remoteChapterList.map((ch: any) => String(ch.id).trim()));
                    const localChapters = Array.isArray(fullData.chapters) ? fullData.chapters : [];
                    const localScenes = Array.isArray(fullData.scenes) ? fullData.scenes : [];
                    
                    const localChapterMap = new Map<string, any>(localChapters.map((ch: any) => [ch.id.replace("chap-", ""), ch]));
                    const localSceneMap = new Map<string, any>(localScenes.map((sc: any) => [sc.chapterId, sc]));

                    const missingChapterIds: string[] = [];
                    const faultyChapterIds: string[] = [];

                    for (const rcId of remoteChapterIds) {
                        if (!localChapterMap.has(rcId)) {
                            missingChapterIds.push(rcId);
                        }
                    }

                    for (const ch of localChapters) {
                        const numericId = ch.id.replace("chap-", "");
                        const scene = localSceneMap.get(ch.id);
                        
                        let isFaulty = false;
                        let reason = "";

                        if (!scene || !scene.content) {
                            isFaulty = true;
                            reason = "Thiếu nội dung";
                        } else {
                            const content = String(scene.content).trim();
                            const contentLower = content.toLowerCase();
                            
                            if (content.length < 100) {
                                isFaulty = true;
                                reason = "Nội dung quá ngắn (<100 ký tự)";
                            } else if (
                                contentLower.includes("proxy error") ||
                                contentLower.includes("fetch failed") ||
                                contentLower.includes("bad gateway") ||
                                contentLower.includes("gateway timeout") ||
                                contentLower.includes("service unavailable") ||
                                contentLower.includes("internal server error")
                            ) {
                                isFaulty = true;
                                reason = "Chứa từ khóa lỗi Proxy/Fetch";
                            }
                        }

                        if (isFaulty) {
                            faultyChapterIds.push(numericId);
                        }
                    }

                    const allProblemIds = [...new Set([...missingChapterIds, ...faultyChapterIds])];

                    if (allProblemIds.length > 0) {
                        setErrorScanLog(prev => [
                            ...prev, 
                            `🛠️ [${novel.title}] Có ${missingChapterIds.length} ch thiếu, ${faultyChapterIds.length} ch lỗi (${allProblemIds.join(", ")}). Đang đưa vào hàng đợi tự động sửa.`
                        ]);
                        
                        mottruyenGlobalRefs.downloadQueue.push({
                            id: mottruyenId,
                            novelData: storyData.data,
                            isUpdateOrFix: true,
                            faultyChapterIds: allProblemIds
                        });
                        
                        processDownloadQueue();
                        fixedCount++;
                    } else {
                        if (Number(novel.wrongChaptersCount) > 0) {
                            setErrorScanLog(prev => [...prev, `🔄 [${novel.title}] Có cảnh báo lỗi chương (${novel.wrongChaptersCount} ch) nhưng không có lỗi thực tế. Đang xóa cảnh báo...`]);
                            try {
                                const clearRes = await fetch(`/api/reading-room?action=edit_metadata&id=${novel.id}`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        newWrongChaptersCount: 0,
                                        newReviewIssues: []
                                    })
                                });
                                if (clearRes.ok) {
                                    setErrorScanLog(prev => [...prev, `✅ [${novel.title}] Đã xóa cảnh báo thành công.`]);
                                } else {
                                    setErrorScanLog(prev => [...prev, `⚠️ [${novel.title}] Không thể xóa cảnh báo trên máy chủ.`]);
                                }
                            } catch (clearErr: any) {
                                setErrorScanLog(prev => [...prev, `⚠️ [${novel.title}] Lỗi khi gửi lệnh xóa cảnh báo: ${clearErr.message}`]);
                            }
                        } else {
                            setErrorScanLog(prev => [...prev, `✅ [${novel.title}] Hợp lệ (không phát hiện lỗi).`]);
                        }
                    }
                } catch (e: any) {
                    setErrorScanLog(prev => [...prev, `❌ [${novel.title}] Gặp lỗi khi phân tích: ${e.message}`]);
                }
                
                await new Promise(r => setTimeout(r, 300));
            }

            if (fixedCount > 0) {
                toast.success(`Quét xong! Phát hiện & đang tự động sửa lỗi cho ${fixedCount} truyện.`);
            } else {
                toast.success("Quét xong! Không phát hiện truyện nào bị lỗi chương. ✅");
            }
        } catch (err: any) {
            toast.error("Lỗi khi quét lỗi: " + err.message);
        } finally {
            setErrorScanStatus("done");
        }
    };

    return (
        <Card className="border border-blue-500/20 bg-blue-500/5 shadow-sm backdrop-blur-md">
            <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle className="text-sm">Quét API Mottruyen</CardTitle>
                        <CardDescription className="text-xs mt-1">
                            {status === "idle" && <>Tự động lưu vào <strong>Thư viện</strong> & <strong>Phòng Đọc</strong>. Chống tải trùng & tự nối chương thiếu.</>}
                            {status === "running" && `Đang quét từ ID ${currentId} • Tải thành công: ${successCount} / Đã duyệt: ${totalProcessed}`}
                            {status === "paused" && `Tạm dừng ở ID ${currentId} • Thành công: ${successCount}`}
                            {status === "finished" && `Hoàn tất! Đã duyệt đến ${endId} • Thành công: ${successCount}`}
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                        <Button
                            variant="outline" size="sm"
                            onClick={checkForUpdates}
                            disabled={updateStatus === "checking" || status === "running"}
                            className="shrink-0"
                        >
                            {updateStatus === "checking" ? (
                                <><Loader2Icon className="size-3.5 mr-1 animate-spin" />Đang kiểm tra...</>
                            ) : (
                                <><RefreshCwIcon className="size-3.5 mr-1" />Kiểm tra cập nhật</>
                            )}
                        </Button>

                        <Button
                            variant="outline" size="sm"
                            onClick={scanReadingRoomErrors}
                            disabled={errorScanStatus === "scanning" || status === "running"}
                            className="shrink-0 border-red-500/30 text-red-600 hover:bg-red-500/10"
                        >
                            {errorScanStatus === "scanning" ? (
                                <><Loader2Icon className="size-3.5 mr-1 animate-spin" />Đang quét lỗi...</>
                            ) : (
                                <><AlertTriangleIcon className="size-3.5 mr-1" />Quét lỗi</>
                            )}
                        </Button>

                        <div className="flex items-center gap-1.5 border border-muted-foreground/20 rounded-md p-1 bg-background/50 h-9 shrink-0">
                            <span className="text-xs text-muted-foreground pl-1 shrink-0">Tải song song:</span>
                            <Input
                                type="number"
                                value={parallelLimitInput}
                                onChange={e => setParallelLimitInput(e.target.value)}
                                className="w-12 h-7 text-xs px-1 text-center bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min={1}
                                max={50}
                                title="Số lượng truyện tải song song"
                            />
                            <Button
                                onClick={handleSaveParallelLimit}
                                className="h-7 text-[10px] px-2 shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                            >
                                Lưu
                            </Button>
                        </div>

                        {status === "idle" && (
                            <>
                                <Input type="number" value={startId} onChange={e => { setStartId(Number(e.target.value)); setCurrentId(Number(e.target.value)); }} className="w-24 h-9" title="Từ ID" />
                                <span className="text-xs text-muted-foreground">-</span>
                                <Input type="number" value={endId} onChange={e => setEndId(Number(e.target.value))} className="w-28 h-9" title="Đến ID" />
                                <span className="text-xs text-muted-foreground ml-2">Batch:</span>
                                <Input type="number" value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} className="w-20 h-9" title="Số luồng song song" />

                                <Input type="text" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} placeholder="Tên thể loại ( vd: Tiên hiệp )" className="w-48 h-9 ml-2" title="Lọc theo thể loại" />

                                <Button onClick={startScan} className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white ml-2">
                                    <PlayIcon className="size-4 mr-1.5" />
                                    Bắt đầu
                                </Button>
                            </>
                        )}
                        {status === "running" && (
                            <Button variant="outline" size="sm" onClick={pauseScan}>
                                <PauseIcon className="size-3.5 mr-1" />
                                Tạm dừng
                            </Button>
                        )}
                        {status === "paused" && (
                            <>
                                <Button size="sm" onClick={startScan} className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white">
                                    <PlayIcon className="size-3.5 mr-1" />
                                    Tiếp tục
                                </Button>
                                <Button variant="outline" size="sm" onClick={resetScan}>
                                    Reset
                                </Button>
                            </>
                        )}
                        {status === "finished" && (
                            <Button variant="outline" size="sm" onClick={resetScan}>
                                <RefreshCwIcon className="size-3.5 mr-1" />
                                Đặt lại
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            {(status !== "idle" || updatableNovels.length > 0 || errorScanStatus !== "idle" || errorScanLog.length > 0) && (
                <CardContent className="pt-0">
                    <div className="space-y-4">
                        {status !== "idle" && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Tiến độ tổng: {Math.min(100, Math.round(((currentId - startId) / (endId - startId)) * 100))}%</span>
                                    <span>ID hiện tại: {currentId} / {endId}</span>
                                </div>
                                <Progress value={Math.min(100, ((currentId - startId) / (endId - startId)) * 100)} className="h-2" />
                            </div>
                        )}

                        {errorScanStatus !== "idle" && (
                            <div className="space-y-2 p-3 rounded-lg border border-red-500/10 bg-red-500/5 text-xs">
                                <div className="flex justify-between font-medium text-red-600">
                                    <span>Quét lỗi phòng đọc...</span>
                                    <span>{errorProgress.current} / {errorProgress.total} truyện</span>
                                </div>
                                <Progress value={errorProgress.total > 0 ? (errorProgress.current / errorProgress.total) * 100 : 0} className="h-1.5 bg-red-100" />
                            </div>
                        )}

                        {errorScanLog.length > 0 && (
                            <div className="space-y-1.5 pt-2 border-t border-border/50">
                                <h4 className="text-xs font-semibold text-red-500 ml-1">Nhật ký quét lỗi:</h4>
                                <div className="bg-muted/50 p-2.5 rounded-lg text-[10px] font-mono space-y-1 max-h-[200px] overflow-y-auto border">
                                    {errorScanLog.map((log, idx) => (
                                        <div key={idx} className="leading-relaxed break-words">{log}</div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {Object.keys(progressData).length > 0 && (
                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                {Object.entries(progressData)
                                    .filter(([id, p]) => p.status === "fetching" || p.status === "done" || p.status === "paused")
                                    .sort((a, b) => Number(b[0]) - Number(a[0]))
                                    .map(([id, p]) => {
                                        const pct = p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0;
                                        return (
                                            <div key={id} className={`p-2 border rounded-lg text-xs flex flex-col gap-1.5 ${p.status === "done" ? "bg-green-500/10 border-green-500/20" : "bg-blue-500/5 border-blue-500/20"}`}>
                                                <div className="flex justify-between font-medium">
                                                    <span className="truncate pr-4" title={p.name}>[ID {id}] {p.name}</span>
                                                    <span className="shrink-0">{pct}%</span>
                                                </div>
                                                <div className="flex justify-between text-muted-foreground">
                                                    <span>Đã tải: {p.downloaded} / {p.total} chương</span>
                                                    <span>{p.status === "done" ? "Hoàn tất" : "Đang tải..."}</span>
                                                </div>
                                                {p.status === "fetching" && <Progress value={pct} className="h-1.5" />}
                                            </div>
                                        );
                                    })}
                            </div>
                        )}

                        {updatableNovels.length > 0 && (
                            <div className="pt-4 mt-4 border-t border-border/50">
                                <h3 className="text-sm font-semibold text-emerald-500 mb-3 ml-1 flex items-center gap-1.5">
                                    <ZapIcon className="size-4" />
                                    Có {updatableNovels.length} truyện có chương mới:
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-2 pb-2">
                                    {updatableNovels.map((novel) => {
                                        const isUp = updatingIds.has(novel.mottruyenId);
                                        return (
                                            <div key={novel.localId} className="flex flex-col border rounded-lg p-3 relative bg-card shadow-sm hover:border-emerald-500/50 transition-colors">
                                                <div className="flex gap-3 mb-3">
                                                    {novel.coverImage ? (
                                                        <img src={novel.coverImage} alt={novel.title} className="w-12 h-16 object-cover rounded-md shadow-sm shrink-0" />
                                                    ) : (
                                                        <div className="w-12 h-16 bg-muted rounded-md flex items-center justify-center shrink-0">
                                                            <GlobeIcon className="size-5 text-muted-foreground" />
                                                        </div>
                                                    )}
                                                    <div className="flex flex-col justify-between overflow-hidden">
                                                        <div className="font-semibold text-sm line-clamp-2" title={novel.title}>{novel.title}</div>
                                                        <div className="text-xs text-muted-foreground">ID: {novel.mottruyenId}</div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between mt-auto pt-2 border-t text-xs">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-muted-foreground line-through decoration-muted-foreground/30">{novel.localChapterCount} ch</span>
                                                        <span className="font-bold text-emerald-500">{novel.remoteChapterCount} ch ↑</span>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => updateNovel(novel)}
                                                        disabled={isUp}
                                                        className="h-7 text-xs bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500 hover:text-white"
                                                    >
                                                        {isUp ? (
                                                            <><Loader2Icon className="size-3 mr-1 animate-spin" />Đang thêm</>
                                                        ) : (
                                                            <><DownloadIcon className="size-3 mr-1" />Tải +{novel.newChapters}</>
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            )}
        </Card>
    );
}

function MottruyenIdDownloaderCard() {
    const [idsInput, setIdsInput] = useState("");
    const [loading, setLoading] = useState(false);

    const handleDownload = async () => {
        const cleanedIds = idsInput
            .split(",")
            .map(id => id.trim())
            .filter(id => id.length > 0 && !isNaN(Number(id)));

        if (cleanedIds.length === 0) {
            toast.error("Vui lòng nhập ít nhất một ID hợp lệ (số).");
            return;
        }

        setLoading(true);
        toast.info(`Bắt đầu xử lý tải cho ${cleanedIds.length} ID truyện...`);

        try {
            for (const idStr of cleanedIds) {
                const id = parseInt(idStr);
                try {
                    const storyRes = await fetch(`/api/mottruyen-proxy?url=${encodeURIComponent(`http://api.mottruyen.com/story/?story_id=${id}`)}`);
                    if (!storyRes.ok) {
                        toast.error(`ID ${id}: Không tải được thông tin từ API Mottruyen`);
                        continue;
                    }
                    const storyData = await storyRes.json();
                    if (storyData?.success === 1 && storyData.data) {
                        mottruyenGlobalRefs.downloadQueue.push({
                            id: id,
                            novelData: storyData.data,
                            isUpdateOrFix: true
                        });
                        processDownloadQueue();
                        toast.success(`Đã thêm ID ${id} (${storyData.data.NAME || "Không tên"}) vào hàng đợi tải.`);
                    } else {
                        toast.error(`ID ${id}: Truyện không tồn tại hoặc API lỗi`);
                    }
                } catch (e: any) {
                    toast.error(`Lỗi khi xử lý ID ${id}: ${e.message}`);
                }
                await new Promise(r => setTimeout(r, 200));
            }
            setIdsInput("");
        } catch (err: any) {
            toast.error("Lỗi: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="border border-violet-500/20 bg-violet-500/5 shadow-sm backdrop-blur-md flex flex-col justify-between">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-violet-600">
                    <DownloadIcon className="size-4" />
                    Tải Truyện Mottruyen Theo ID
                </CardTitle>
                <CardDescription className="text-xs">
                    Nhập danh sách ID truyện Mottruyen cần tải (cách nhau bởi dấu phẩy). Dành riêng cho tải lẻ không ảnh hưởng quét dải ID hàng loạt.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
                <div className="flex gap-2 items-center">
                    <Input
                        value={idsInput}
                        onChange={e => setIdsInput(e.target.value)}
                        placeholder="Ví dụ: 14336, 17290, 30192"
                        className="flex-1 h-9"
                        disabled={loading}
                    />
                    <Button
                        onClick={handleDownload}
                        disabled={loading}
                        className="h-9 bg-gradient-to-r from-violet-600 to-purple-600 text-white shrink-0 font-medium"
                    >
                        {loading ? (
                            <><Loader2Icon className="size-3.5 mr-1.5 animate-spin" />Đang thêm...</>
                        ) : (
                            <><PlayIcon className="size-3.5 mr-1.5" />Bắt đầu tải</>
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
