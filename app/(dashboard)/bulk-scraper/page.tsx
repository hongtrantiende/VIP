"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
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

    const handleStart = () => {
        store.startAutoScan(DEFAULT_URL);
        toast.success("Bắt đầu quét tự động truyenfull.today — 5 luồng song song");
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
                                <Button
                                    onClick={handleStart}
                                    className="bg-gradient-to-r from-violet-600 to-purple-600 text-white"
                                >
                                    <ZapIcon className="size-4 mr-1.5" />
                                    Bắt đầu quét
                                </Button>
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
