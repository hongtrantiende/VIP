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
            <MottruyenScannerCard />


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
                    <XCircleIcon className="size-3.5 text-muted-foreground" />
                </Button>
            )}
        </div>
    );
}

import { useMottruyenStore, mottruyenGlobalRefs } from "@/lib/stores/mottruyen-scraper";

function MottruyenScannerCard() {
    // 1. Lấy state từ Zustand thay vì useState cục bộ
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

    // startId chỉ dùng UI tạm thời để input
    const [startId, setStartId] = useState(currentId === 800 ? 800 : currentId);

    // Dùng global refs thay vì React.useRef để sống sót khi Component Unmount
    const downloadQueueRef = {
        get current() { return mottruyenGlobalRefs.downloadQueue; },
        set current(val) { mottruyenGlobalRefs.downloadQueue = val; }
    };
    const activeDownloadsCountRef = {
        get current() { return mottruyenGlobalRefs.activeDownloadsCount; },
        set current(val) { mottruyenGlobalRefs.activeDownloadsCount = val; }
    };
    const readingRoomIndexRef = {
        get current() { return mottruyenGlobalRefs.readingRoomIndex; },
        set current(val) { mottruyenGlobalRefs.readingRoomIndex = val; }
    };

    // Gắn liền cờ runningRef vào status `running` từ cache toàn cục (store.getState) để tránh "stale closure"
    const runningRef = {
        get current() { return useMottruyenStore.getState().status === "running"; }
    };

    // Live counters in refs -> link tới global refs
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

    // Nạp danh sách truyện trong phòng đọc khi mở component (Chỉ tải 1 lần)
    React.useEffect(() => {
        if (mottruyenGlobalRefs.readingRoomIndex.size > 0) return;
        fetch('/api/reading-room?action=list')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.novels) {
                    const ids = data.novels.map((n: any) => n.id);
                    readingRoomIndexRef.current = new Set(ids);
                }
            })
            .catch(console.error);
    }, []);

    // Đồng bộ DOM khi quay lại Tab
    React.useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible' && runningRef.current) {
                // Ép component cập nhật lại giá trị mới nhất
                setSuccessCount(successCountRef.current);
                setTotalProcessed(totalProcessedRef.current);
                setCurrentId(currentIdRef.current);
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    const processDownloadQueue = async () => {
        // Cố định số luồng tải truyện song song tối đa là 10
        if (!runningRef.current || downloadQueueRef.current.length === 0 || activeDownloadsCountRef.current >= 10) {
            return;
        }

        const novelInfo = downloadQueueRef.current.shift();
        if (!novelInfo) return;

        activeDownloadsCountRef.current++;
        try {
            await downloadNovelInFrontend(novelInfo);
            successCountRef.current++;
            setSuccessCount(successCountRef.current);
        } catch (e) {
            console.error("Lỗi tải truyện:", e);
        } finally {
            activeDownloadsCountRef.current--;
            // Tải xong bộ này, tự động gọi tải bộ tiếp theo trong hàng đợi
            processDownloadQueue();
        }
    };

    const downloadNovelInFrontend = async (novelInfo: any) => {
        const { id, novelData } = novelInfo;
        const novelIdStr = `mottruyen-${id}`;

        try {
            // 1. Kiểm tra Phòng Đọc trước — nếu đã upload đủ rồi thì bỏ qua
            if (readingRoomIndexRef.current.has(novelIdStr)) {
                console.log(`[ID ${id}] Đã có trong Phòng Đọc, bỏ qua.`);
                return;
            }

            const totalChap = parseInt(novelData.TOTALCHAPTER || "0");

            // 2. Kiểm tra Thư viện cục bộ — nếu đang tải dở thì tiếp tục
            const existingInDb = await db.novels.get(novelIdStr);
            const existingChapters = existingInDb
                ? await db.chapters.where("novelId").equals(novelIdStr).toArray()
                : [];

            let resumeMode = existingInDb && existingChapters.length > 0;
            let downloadedCount = existingChapters.length;

            setProgressData(prev => ({
                ...prev,
                [id]: { name: novelData.NAME, downloaded: downloadedCount, total: totalChap, status: "fetching" }
            }));

            let extractedGenres: string[] = [];
            if (typeof novelData.KIND === 'string' && novelData.KIND.trim() !== '') {
                extractedGenres = novelData.KIND.split(/[,;\-]/).map((k: string) => k.trim()).filter(Boolean);
            }
            const resolvedGenres = extractedGenres.length > 0 ? extractedGenres : (existingInDb?.genres || []);

            // Xoá console log, hiển thị thẳng lên màn hình để User Test
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

            let novelObj = existingInDb ? {
                ...existingInDb,
                title: cleanedTitle,
                description: cleanedDesc,
                genres: resolvedGenres,
                genre: novelData.KIND || existingInDb.genre || "",
            } : {
                id: novelIdStr,
                title: cleanedTitle,
                author: novelData.AUTHOR || "Unknown",
                coverImage: novelData.IMG || "",
                description: cleanedDesc,
                genres: resolvedGenres,
                genre: novelData.KIND || "", // Lưu thêm chuỗi gốc để hỗ trợ text hiển thị
                sourceUrl: `http://api.mottruyen.com/story/?story_id=${id}`,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // Luôn cập nhật lại vào DB để đảm bảo (vd: bộ tải dở chưa có thể loại sẽ được gán lại)
            await db.novels.put(novelObj);

            // Tập hợp chapter IDs đã tải (để bỏ qua)
            const alreadyFetchedChapterIds = new Set(
                existingChapters.map(ch => ch.id.replace("chap-", ""))
            );

            // 3. Crawl toàn bộ chương (Bi-directional)
            let initialChapterIds: string[] = Array.isArray(novelData.CHAPTER)
                ? novelData.CHAPTER
                    .map((ch: any) => String(ch?.id ?? "").trim())
                    .filter((id: string) => id.length > 0)
                : [];

            if (initialChapterIds.length === 0) {
                setProgressData(prev => ({ ...prev, [id]: { ...prev[id], status: "done" } }));
                return;
            }

            // Chỉ queue các chương chưa tải
            const queue: string[] = initialChapterIds.filter(cId => !alreadyFetchedChapterIds.has(cId));
            const processed = new Set<string>([...alreadyFetchedChapterIds]);
            let activeCount = 0;
            const CONCURRENCY = 15;

            let lastUiUpdate = Date.now();

            const fetchAndStore = async (cId: string) => {
                if (processed.has(cId) || !runningRef.current) return;
                processed.add(cId);
                activeCount++;

                try {
                    const proxyUrl = encodeURIComponent(`http://api.mottruyen.com/chapter/?chapter_id=${cId}`);
                    const chapRes = await fetch(`/api/mottruyen-proxy?url=${proxyUrl}`);
                    if (!chapRes.ok) throw new Error("Fetch failed");

                    const chapData = await chapRes.json();
                    if (chapData?.success === 1 && chapData.data) {
                        const data = chapData.data;

                        // Xử lý nội dung (Dùng DOMParser để giải mã toàn bộ HTML Entities &aacute;, &nbsp;, v.v.)
                        let chapName = data.ENAME || `Chương ${data.ORDER || "?"}`;
                        try {
                            chapName = new DOMParser().parseFromString(chapName, "text/html").documentElement.textContent || chapName;
                        } catch (e) { }

                        let chapContent = data.CONTENT || "";
                        // Thay thế thẻ ngắt đoạn bằng newline trước khi decode để không bị dính liền
                        chapContent = chapContent.replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");

                        try {
                            chapContent = new DOMParser().parseFromString(chapContent, "text/html").documentElement.textContent || chapContent;
                        } catch (e) { }

                        // Lọc dòng rỗng, quảng cáo, và nối lại bằng \n\n để tạo ĐÚNG 1 KHOẢNG TRỐNG (gap)
                        chapContent = chapContent.split('\n')
                            .map((l: string) => l.trim())
                            .filter((line: string) => {
                                if (!line) return false;
                                const lower = line.toLowerCase();
                                const blacklist = ["người đăng", "thời gian đổi mới", "thời gian cập nhật", "cầu nguyệt phiếu", "nhóm dịch", "mời đọc giả", "mottruyen.com"];
                                return !blacklist.some(b => lower.includes(b));
                            }).join('\n\n').trim();

                        const order = parseInt(data.ORDER || "0");
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

                        // Thêm NEXT và PREV vào hàng đợi nếu chưa có
                        if (data.NEXT && data.NEXT !== "0" && !processed.has(data.NEXT)) {
                            queue.push(data.NEXT);
                        }
                        if (data.PREV && data.PREV !== "0" && !processed.has(data.PREV)) {
                            queue.push(data.PREV);
                        }

                        // Cập nhật UI
                        if (Date.now() - lastUiUpdate > 1000) {
                            setProgressData(prev => ({ ...prev, [id]: { ...prev[id], downloaded: downloadedCount } }));
                            lastUiUpdate = Date.now();
                        }
                    }
                } catch (e) {
                    console.error(`Lỗi tải chương ${cId}:`, e);
                } finally {
                    activeCount--;
                }
            };

            // Loop chính của Crawler bằng Promise worker (không dùng setTimeout polling liên tục để tránh browser throttle)
            const workers = Array.from({ length: CONCURRENCY }, async () => {
                while (runningRef.current) {
                    const cId = queue.shift();
                    if (cId) {
                        await fetchAndStore(cId);
                    } else if (activeCount > 0) {
                        // Hàng đợi rỗng nhưng có luồng khác đang fetch (có thể sẽ đẩy thêm NEXT vào queue)
                        await new Promise(r => setTimeout(r, 100));
                    } else {
                        // Hoàn toàn kết thúc
                        break;
                    }
                }
            });
            await Promise.all(workers);

            if (!runningRef.current) {
                setProgressData(prev => ({ ...prev, [id]: { ...prev[id], status: "paused" } }));
                // Trả lại bộ truyện về đầu hàng đợi để khi resume sẽ tiếp tục tải bộ này
                downloadQueueRef.current.unshift(novelInfo);
                return;
            }

            setProgressData(prev => ({ ...prev, [id]: { ...prev[id], downloaded: downloadedCount, status: "done" } }));

            // 4. Upload to Reading Room
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
            const CHUNK_SIZE = 2 * 1024 * 1024;
            const totalChunks = Math.ceil(jsonString.length / CHUNK_SIZE);
            const uploadId = crypto.randomUUID();

            let uploadSuccess = true;

            for (let i = 0; i < totalChunks; i++) {
                const chunk = jsonString.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                const uploadRes = await fetch(`/api/reading-room?action=upload_chunk&novelId=${novelObj.id}&uploadId=${uploadId}&chunkIndex=${i}&totalChunks=${totalChunks}`, {
                    method: "POST",
                    body: chunk,
                });
                if (!uploadRes.ok) {
                    uploadSuccess = false;
                    break;
                }
            }

            if (uploadSuccess) {
                // Đánh dấu đã có trong Reading Room cache
                readingRoomIndexRef.current.add(novelIdStr);
                toast.success(`Đã lưu phòng đọc: ${novelObj.title} (${downloadedCount} ch)`);
                // Xóa cục bộ sau khi upload thành công
                await Promise.all([
                    db.scenes.where("novelId").equals(novelObj.id).delete(),
                    db.chapters.where("novelId").equals(novelObj.id).delete(),
                    db.novels.delete(novelObj.id)
                ]);

                setProgressData(prev => {
                    const newData = { ...prev };
                    delete newData[id];
                    return newData;
                });
            } else {
                toast.error(`Lỗi upload phòng đọc: ${novelObj.title}`);
            }
        } catch (err) {
            console.error("Lỗi downloadNovelInFrontend:", err);
            setProgressData(prev => ({ ...prev, [id]: { ...prev[id], status: "error" } }));
        }


    };

    const startScan = async () => {
        if (useMottruyenStore.getState().status === "running") return;
        if (currentId >= endId) return;
        setStatus("running");

        let cid = currentId;
        while (useMottruyenStore.getState().status === "running" && cid <= endId) {
            // Ngăn chặn quét quá nhanh làm tràn bộ nhớ
            if (downloadQueueRef.current.length >= batchSize * 2) {
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

                    // Thêm truyện hợp lệ vào hàng đợi
                    if (data.validNovels && data.validNovels.length > 0) {
                        downloadQueueRef.current.push(...data.validNovels);

                        // Kích hoạt các luồng tải song song (tối đa bằng 10 bộ truyện)
                        for (let i = activeDownloadsCountRef.current; i < 10; i++) {
                            processDownloadQueue();
                        }
                    }

                    totalProcessedRef.current += data.totalScanned;
                    setTotalProcessed(totalProcessedRef.current);
                }
            } catch (err) {
                console.error(err);
            }

            if (useMottruyenStore.getState().status !== "running") break;
            cid += batchSize;
            currentIdRef.current = cid;
            setCurrentId(cid);
        }

        if (cid > endId) {
            // Chờ cho tất cả các tiến trình tải còn lại hoàn tất
            const waitFinish = setInterval(() => {
                if (activeDownloadsCountRef.current === 0 && downloadQueueRef.current.length === 0) {
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

    // ── Kiểm tra cập nhật chương mới ──
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
            // 1. Load Reading Room index
            const rrRes = await fetch("/api/reading-room?action=list");
            const rrData = await rrRes.json();
            const rrNovels: any[] = rrData.novels || [];

            // 2. Filter mottruyen novels and extract IDs + chapter counts
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

            // 3. Call check-updates API
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
            // Gọi lại hàm downloadNovelInFrontend bằng cách fetch story info
            const storyRes = await fetch(`/api/mottruyen-proxy?url=${encodeURIComponent(`http://api.mottruyen.com/story/?story_id=${novel.mottruyenId}`)}`);
            const storyData = await storyRes.json();
            if (storyData?.success === 1 && storyData.data) {
                // Push to download queue
                downloadQueueRef.current.push({ id: novel.mottruyenId, novelData: storyData.data });
                processDownloadQueue();
                toast.success(`Đang tải thêm ${novel.newChapters} chương mới: ${novel.title}`);

                // Xóa khỏi danh sách updatable
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

    return (
        <Card>
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
                        {/* Nút Kiểm tra cập nhật — luôn hiển thị */}
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
            {status !== "idle" && (
                <CardContent className="pt-0">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Tiến độ tổng: {Math.min(100, Math.round(((currentId - startId) / (endId - startId)) * 100))}%</span>
                                <span>ID hiện tại: {currentId} / {endId}</span>
                            </div>
                            <Progress value={Math.min(100, ((currentId - startId) / (endId - startId)) * 100)} className="h-2" />
                        </div>

                        {/* Chi tiết từng truyện đang tải */}
                        {Object.keys(progressData).length > 0 && (
                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                {Object.entries(progressData)
                                    .filter(([id, p]) => p.status === "fetching" || p.status === "done" || p.status === "paused")
                                    // Sắp xếp ID lớn hơn lên trên để dễ xem
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

                        {/* Danh sách cập nhật chương mới */}
                        {updatableNovels.length > 0 && (
                            <div className="pt-4 mt-4 border-t border-border/50">
                                <h3 className="text-sm font-semibold text-emerald-500 mb-3 ml-1 flex items-center gap-1.5">
                                    <ZapIcon className="size-4" />
                                    Có {updatableNovels.length} truyện có chương mới:
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[600px] overflow-y-auto pr-2 pb-2">
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
