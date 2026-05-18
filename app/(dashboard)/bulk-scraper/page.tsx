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
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                    <GlobeIcon className="size-5 text-violet-500" />
                </div>
                <div>
                    <h1 className="text-xl font-bold">Quét Website Tự Động</h1>
                    <p className="text-xs text-muted-foreground">
                        Tự động quét & tải song song 5 bộ từ {DEFAULT_URL}
                    </p>
                </div>
                <Badge variant="secondary" className="ml-auto text-[10px] uppercase font-bold">
                    Admin Only
                </Badge>
            </div>

            {/* Control Panel */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
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
                        <div className="flex gap-2">
                            {store.phase === "idle" && (
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={targetUrl}
                                        onChange={(e) => setTargetUrl(e.target.value)}
                                        placeholder="Nhập URL (hoặc wikicv.net...)"
                                        className="w-56 h-9"
                                    />
                                    <Button
                                        onClick={handleStart}
                                        className="bg-gradient-to-r from-violet-600 to-purple-600 text-white"
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
                        <div className="grid grid-cols-4 gap-3 mb-4">
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
            {activeJobs.length > 0 && (
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
            )}

            {/* Completed Jobs */}
            {finishedJobs.length > 0 && (
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
            )}
        </div>
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

function MottruyenScannerCard() {
    const [startId, setStartId] = useState(800);
    const [endId, setEndId] = useState(1000000);
    const [batchSize, setBatchSize] = useState(100);
    const [currentId, setCurrentId] = useState(800);
    const [status, setStatus] = useState<"idle" | "running" | "paused" | "finished">("idle");
    const [successCount, setSuccessCount] = useState(0);
    const [totalProcessed, setTotalProcessed] = useState(0);
    const [progressData, setProgressData] = useState<Record<string, {name: string, downloaded: number, total: number, status: string}>>({});

    // Use a ref to keep track of running state to break the loop instantly
    const runningRef = React.useRef(false);

    React.useEffect(() => {
        let interval: NodeJS.Timeout;
        if (status === "running") {
            interval = setInterval(async () => {
                try {
                    const res = await fetch("/api/mottruyen-scanner/progress");
                    if (res.ok) {
                        const data = await res.json();
                        setProgressData(data);

                        // Tự động import và tải lên Phòng Đọc khi hoàn tất
                        Object.entries(data).forEach(async ([id, p]: [string, any]) => {
                            if (p.status === "done" && !p.savedToDb) {
                                // Đánh dấu đã xử lý để không gọi lại nhiều lần
                                data[id].savedToDb = true;
                                setProgressData({ ...data });

                                try {
                                    const dlRes = await fetch(`/api/mottruyen-scanner/download?id=${id}`);
                                    if (dlRes.ok) {
                                        const novelData = await dlRes.json();
                                        const now = new Date();

                                        // 1. Lưu vào Thư viện cá nhân (IndexedDB)
                                        await db.novels.put({
                                            id: novelData.id,
                                            title: novelData.title,
                                            author: novelData.author,
                                            coverImage: novelData.coverUrl,
                                            description: novelData.description,
                                            sourceUrl: novelData.sourceUrl,
                                            createdAt: now,
                                            updatedAt: now,
                                        });

                                        const chapterPuts = novelData.chapters.map((ch: any) => ({
                                            id: ch.id,
                                            novelId: novelData.id,
                                            title: ch.title,
                                            order: ch.orderIndex,
                                            createdAt: now,
                                            updatedAt: now,
                                        }));

                                        const scenePuts = novelData.chapters.map((ch: any) => ({
                                            id: `scene-${ch.id}`,
                                            novelId: novelData.id,
                                            chapterId: ch.id,
                                            content: ch.content,
                                            order: 0,
                                            version: 1,
                                            versionType: "manual" as any,
                                            isActive: 1,
                                            createdAt: now,
                                            updatedAt: now,
                                        }));

                                        await db.chapters.bulkPut(chapterPuts);
                                        await db.scenes.bulkPut(scenePuts);

                                        // 2. Tự động tải lên Reading Room
                                        const exportData = {
                                            novel: await db.novels.get(novelData.id),
                                            chapters: await db.chapters.where("novelId").equals(novelData.id).toArray(),
                                            scenes: await db.scenes.where("novelId").equals(novelData.id).toArray()
                                        };

                                        const uploadRes = await fetch(`/api/reading-room?action=upload&novelId=${novelData.id}`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify(exportData),
                                        });

                                        if (uploadRes.ok) {
                                            toast.success(`Đã tự động tải lên phòng đọc: ${novelData.title}`);
                                        }
                                    }
                                } catch(err) {
                                    console.error("Lỗi khi lưu/đăng truyện", err);
                                }
                            }
                        });
                    }
                } catch (e) {
                    // Ignore errors during polling
                }
            }, 1500);
        }
        return () => clearInterval(interval);
    }, [status]);

    const startScan = async () => {
        if (currentId >= endId) return;
        setStatus("running");
        runningRef.current = true;
        
        let cid = currentId;
        while (runningRef.current && cid <= endId) {
            try {
                const res = await fetch("/api/mottruyen-scanner", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ startId: cid, batchSize: Math.min(batchSize, endId - cid + 1) })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    setSuccessCount(prev => prev + data.successCount);
                    setTotalProcessed(prev => prev + data.total);
                }
            } catch (err) {
                console.error(err);
            }

            cid += batchSize;
            setCurrentId(cid);

            if (cid <= endId && runningRef.current) {
                // Sleep 0.5s
                await new Promise(r => setTimeout(r, 500));
            }
        }

        if (cid > endId) {
            setStatus("finished");
            runningRef.current = false;
        }
    };

    const pauseScan = () => {
        setStatus("paused");
        runningRef.current = false;
    };

    const resetScan = () => {
        setStatus("idle");
        setCurrentId(startId);
        setSuccessCount(0);
        setTotalProcessed(0);
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-sm">Quét API Mottruyen</CardTitle>
                        <CardDescription className="text-xs mt-1">
                            {status === "idle" && <>Lưu tự động vào thư mục <strong>downloads/mottruyen</strong> dưới dạng định dạng <strong>JSON chuẩn</strong> (giống y hệt tool quét web).</>}
                            {status === "running" && `Đang quét từ ID ${currentId} • Tải thành công: ${successCount} / Đã duyệt: ${totalProcessed}`}
                            {status === "paused" && `Tạm dừng ở ID ${currentId} • Thành công: ${successCount}`}
                            {status === "finished" && `Hoàn tất! Đã duyệt đến ${endId} • Thành công: ${successCount}`}
                        </CardDescription>
                    </div>
                    <div className="flex gap-2 items-center">
                        {status === "idle" && (
                            <>
                                <Input type="number" value={startId} onChange={e => {setStartId(Number(e.target.value)); setCurrentId(Number(e.target.value));}} className="w-24 h-9" title="Từ ID" />
                                <span className="text-xs text-muted-foreground">-</span>
                                <Input type="number" value={endId} onChange={e => setEndId(Number(e.target.value))} className="w-28 h-9" title="Đến ID" />
                                <span className="text-xs text-muted-foreground ml-2">Batch:</span>
                                <Input type="number" value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} className="w-20 h-9" title="Số luồng song song" />
                                
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
                                     .filter(([id, p]) => p.status === "fetching" || p.status === "done")
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
                     </div>
                 </CardContent>
            )}
        </Card>
    );
}
