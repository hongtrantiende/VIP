"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict } from "@/lib/hooks/use-name-entries";
import { toast } from "sonner";
import {
  Loader2Icon, UploadCloudIcon, CheckCircle2Icon, XCircleIcon,
  ClockIcon, DownloadIcon, TrashIcon, RefreshCwIcon, BotIcon, AlertTriangleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { createSceneVersion, ensureInitialVersion } from "@/lib/hooks/use-scene-versions";
import { useLiveQuery } from "dexie-react-hooks";

interface BotQueueSubmitProps {
  novelId: string;
  chapterIds: string[];
  dictSources: string[];
}

interface QueueJob {
  id: string;
  novel_name: string;
  chapter_count: number;
  status: string;
  current_chapter: number;
  translate_mode: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  worker_name: string | null;
  assigned_worker: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Đang chờ", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: <ClockIcon className="size-3.5" /> },
  translating: { label: "Đang dịch", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400", icon: <Loader2Icon className="size-3.5 animate-spin" /> },
  completed: { label: "Hoàn thành", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: <CheckCircle2Icon className="size-3.5" /> },
  failed: { label: "Thất bại", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400", icon: <XCircleIcon className="size-3.5" /> },
  cancelled: { label: "Đã hủy", color: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400", icon: <XCircleIcon className="size-3.5" /> },
};

const MODE_LABELS: Record<string, string> = {
  hybrid: "Gốc + Thô + AI",
  "stv-hybrid": "Converter AI",
  "pure-ai": "Dịch thuần AI",
};

export function BotQueueSubmit({
  novelId,
  chapterIds,
  dictSources,
}: BotQueueSubmitProps) {
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [myJobs, setMyJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingJobId, setImportingJobId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<string>("hybrid");
  const [selectedWorker, setSelectedWorker] = useState<string>("any");

  useEffect(() => {
    setMounted(true);
  }, []);

  const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);
  const hasPrompt = !!novel?.customTranslatePrompt?.trim();
  const needsPrompt = selectedMode === "pure-ai" && !hasPrompt;

  // Load user's jobs and auto-import completed ones
  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/bot-translate/queue");
      const data = await res.json();
      if (data.jobs) {
        setMyJobs(data.jobs);
        // Auto-import logic
        for (const job of data.jobs) {
          if (job.status === "completed" && job.error_message && job.error_message.includes("output_drive_id:")) {
            const outputFileUrl = job.error_message.split("output_drive_id:")[1];
            // Check if we haven't imported it yet via localstorage flag to prevent infinite loops
            const importedKey = `bot_job_imported_${job.id}`;
            if (!localStorage.getItem(importedKey) && importingJobId !== job.id) {
              console.log("Auto-importing job:", job.id);
              localStorage.setItem(importedKey, "true");
              handleImportResult(job.id, outputFileUrl);
            }
          }
        }
      }
    } catch {
      console.error("Failed to load queue jobs");
    } finally {
      setLoading(false);
    }
  }, [importingJobId]);

  useEffect(() => {
    if (mounted) loadJobs();
    const interval = setInterval(() => {
      if (mounted) loadJobs();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadJobs, mounted]);


  // Submit novel to queue
  const handleSubmit = async () => {
    if (needsPrompt) {
      toast.error("Chế độ Thuần AI yêu cầu phải quét prompt trước! Vui lòng vào tab 'Thuần AI' → 'Cấu hình Prompt Dịch' để quét.");
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Đang chuẩn bị dữ liệu truyện...");

    try {
      const currentNovel = await db.novels.get(novelId);
      if (!currentNovel) throw new Error("Không tìm thấy truyện");

      const chapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
      const selectedChapters = chapters.filter(c => chapterIds.includes(c.id));

      if (selectedChapters.length === 0) {
        toast.error("Chưa chọn chương nào!", { id: toastId });
        setSubmitting(false);
        return;
      }

      toast.loading(`Đang export ${selectedChapters.length} chương...`, { id: toastId });

      const chaptersData = [];
      for (const chapter of selectedChapters) {
        const scenes = await db.scenes.where("chapterId").equals(chapter.id).sortBy("order");
        const sceneData = [];
        for (const scene of scenes) {
          const originalContent = await getOriginalContent(scene.id);
          sceneData.push({ id: scene.id, order: scene.order, content: originalContent });
        }
        chaptersData.push({ id: chapter.id, title: chapter.title, order: chapter.order, scenes: sceneData });
      }

      const nameDict = await getMergedNameDict(novelId);

      toast.loading("Đang gửi lên hàng đợi...", { id: toastId });

      const payload = {
        novelName: currentNovel.title,
        novelGenre: currentNovel.genre || null,
        customPrompt: currentNovel.customTranslatePrompt || null,
        dictSources,
        translateMode: selectedMode,
        promptType: selectedMode === "pure-ai" ? "custom" : "khuyen_nghi",
        extractDict: true,
        nameDict: nameDict.map(n => ({ chinese: n.chinese, vietnamese: n.vietnamese })),
        chapters: chaptersData,
      };

      // 1. Upload JSON to Google Drive
      const jobId = crypto.randomUUID();
      const fileName = `job_${jobId}_input.json`;
      
      const uploadRes = await fetch("/api/bot-translate/queue/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: fileName, content: JSON.stringify(payload) }),
      });
      const uploadData = await uploadRes.json();
      
      if (!uploadRes.ok) throw new Error(`Lỗi tải file lên Drive: ${uploadData.error}`);
      const fileId = uploadData.fileId;

      // 2. Submit Job Metadata to API
      const res = await fetch("/api/bot-translate/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          novelName: currentNovel.title,
          novelGenre: currentNovel.genre || null,
          chapterCount: chaptersData.length,
          inputFileUrl: fileId,
          translateMode: selectedMode,
          customPrompt: currentNovel.customTranslatePrompt || null,
          dictSources,
          promptType: selectedMode === "pure-ai" ? "custom" : "khuyen_nghi",
          extractDict: true,
          assignedWorker: selectedWorker,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi gửi job");

      toast.success(`Đã gửi ${data.chapterCount} chương lên hàng đợi bot dịch!`, { id: toastId });
      loadJobs();
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    const res = await fetch("/api/bot-translate/queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, status: "cancelled" }),
    });
    if (res.ok) { toast.success("Đã hủy job!"); loadJobs(); }
    else toast.error("Lỗi khi hủy job");
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa job này khỏi danh sách không? Lịch sử dịch sẽ bị xóa.")) return;
    const res = await fetch(`/api/bot-translate/queue?jobId=${jobId}`, { method: "DELETE" });
    if (res.ok) { toast.success("Đã xóa job!"); loadJobs(); }
    else toast.error("Lỗi khi xóa job");
  };

  const handleImportResult = async (jobId: string, outputFileUrl?: string) => {
    setImportingJobId(jobId);
    const toastId = toast.loading("Đang tự động cập nhật kết quả dịch...");

    try {
      let finalOutputFileUrl = outputFileUrl;
      if (!finalOutputFileUrl) {
        // Fallback fetch if user clicked manually
        const resJob = await fetch(`/api/bot-translate/queue`);
        const dataJob = await resJob.json();
        const job = dataJob.jobs?.find((j: any) => j.id === jobId);
        if (job?.error_message?.includes("output_drive_id:")) {
           finalOutputFileUrl = job.error_message.split("output_drive_id:")[1];
        }
      }

      if (!finalOutputFileUrl) throw new Error("Job không có file kết quả output trên Drive");

      const res = await fetch(`/api/bot-translate/queue/download?fileId=${finalOutputFileUrl}`);
      const data = await res.json();
      
      if (!res.ok || !data.chapters) throw new Error("Lỗi tải file kết quả từ Drive");

      const currentNovel = await db.novels.get(novelId);
      if (!currentNovel) throw new Error("Không tìm thấy truyện trong máy");

      const localChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
      let importedCount = 0;

      const sortedQueueChapters = [...data.chapters].sort((a, b) => (a.order || 0) - (b.order || 0));

      for (let i = 0; i < sortedQueueChapters.length; i++) {
        const queueChapter = sortedQueueChapters[i];
        if (!queueChapter.translated_scenes) continue;

        // Chiến lược khớp chương thông minh:
        // 1. Thử khớp chính xác theo ID (Tốt nhất)
        // 2. Thử khớp chính xác theo order
        // 3. Thử khớp theo kiểu lệch 1 đơn vị
        let localChapter = queueChapter.id ? localChapters.find(c => c.id === queueChapter.id) : undefined;
        
        if (!localChapter) {
          localChapter = localChapters.find(c => c.order === queueChapter.order);
        }
        
        if (!localChapter) {
          // Thử khớp theo kiểu lệch 1 đơn vị (0-indexed vs 1-indexed)
          localChapter = localChapters.find(c => c.order === (queueChapter.order - 1));
        }

        if (!localChapter && localChapters.length === sortedQueueChapters.length) {
          // Nếu số lượng chương bằng nhau, khớp theo vị trí thứ tự trong mảng
          localChapter = localChapters[i];
        }

        if (!localChapter) {
          console.warn(`[import] Không thể khớp chương cho order: ${queueChapter.order}`);
          continue;
        }

        const localScenes = await db.scenes.where("chapterId").equals(localChapter.id).sortBy("order");

        for (const translatedScene of queueChapter.translated_scenes) {
          let localScene = translatedScene.id ? localScenes.find(s => s.id === translatedScene.id) : undefined;
          if (!localScene) localScene = localScenes.find(s => s.order === translatedScene.order);
          if (!localScene) continue;

          // 1. Lưu bản gốc vào lịch sử nếu chưa có (để có Tab Gốc/Dịch)
          await ensureInitialVersion(localScene.id, novelId, localScene.content);
          
          // 2. Lưu bản dịch AI vào lịch sử phiên bản
          await createSceneVersion(localScene.id, novelId, "ai", translatedScene.content);
          
          // 3. Ghi đè trực tiếp nội dung hiển thị chính bằng bản dịch AI mới
          await db.scenes.update(localScene.id, {
            content: translatedScene.content || "",
            versionType: "ai",
            updatedAt: new Date(),
            wordCount: (translatedScene.content || "").split(/\s+/).filter(Boolean).length
          });
        }

        if (queueChapter.translated_title) {
          await db.chapters.update(localChapter.id, { title: queueChapter.translated_title });
        }

        importedCount++;
      }

      // Import new dict entries if any
      if (data.name_dict && data.name_dict.length > 0) {
        const { bulkImportNameEntries } = await import("@/lib/hooks/use-name-entries");
        await bulkImportNameEntries(novelId, data.name_dict.map((n: any) => ({
          chinese: n.chinese, vietnamese: n.vietnamese, category: "nhân vật", dictType: "names",
        })), "khác", "skip");
      }

      // Đánh dấu là đã nạp thay vì xóa để lưu lịch sử
      await fetch("/api/bot-translate/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: "completed" }), // Ensure it stays completed
      });

      loadJobs();

      toast.success(`Đã nạp tự động ${importedCount} chương và từ điển vào truyện!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi import: ${err.message}`, { id: toastId });
    } finally {
      setImportingJobId(null);
    }
  };

  if (!mounted) return null;

  return (
    <div className="space-y-4">
      {/* Submit section */}
      <div className="rounded-lg border border-dashed border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BotIcon className="size-5 text-blue-500" />
          <div>
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Gửi cho Bot dịch tự động</p>
            <p className="text-[10px] text-muted-foreground">
              Gửi truyện lên hàng đợi. Bot Admin sẽ tự động dịch và trả kết quả cho bạn.
            </p>
          </div>
        </div>

        {/* Mode selector */}
        <div className="space-y-1.5">
          <Label className="text-[11px]">Chế độ dịch</Label>
          <Select value={selectedMode} onValueChange={setSelectedMode}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hybrid">Gốc + Thô + AI (Khuyến nghị)</SelectItem>
              <SelectItem value="stv-hybrid">Converter AI (Dùng STV)</SelectItem>
              <SelectItem value="pure-ai">Dịch thuần AI (Cần quét Prompt)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bot selector */}
        <div className="space-y-1.5">
          <Label className="text-[11px]">Chọn Bot xử lý (Tuỳ chọn)</Label>
          <Select value={selectedWorker} onValueChange={setSelectedWorker}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Bất kỳ Bot nào rảnh</SelectItem>
              <SelectItem value="AI-1">Slot 1 (AI-1)</SelectItem>
              <SelectItem value="AI-2">Slot 2 (AI-2)</SelectItem>
              <SelectItem value="AI-3">Slot 3 (AI-3)</SelectItem>
              <SelectItem value="AI-4">Slot 4 (AI-4)</SelectItem>
              <SelectItem value="AI-5">Slot 5 (AI-5)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Warning if pure-ai needs prompt */}
        {needsPrompt && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Cần quét Prompt trước!</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Chế độ thuần AI yêu cầu quét phong cách truyện trước. Vào tab "Thuần AI" → "Cấu hình Prompt Dịch" để quét.
              </p>
            </div>
          </div>
        )}

        {/* Info summary */}
        <div className="rounded-md bg-muted/50 p-2 text-[11px] space-y-1 text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Số chương gửi:</span>
            <span className="font-semibold text-foreground">{chapterIds.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Chế độ dịch:</span>
            <span className="font-medium">{MODE_LABELS[selectedMode]}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Từ điển:</span>
            <span className="font-medium">{dictSources.join(", ")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Càng dịch càng hay:</span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">✅ Luôn bật</span>
          </div>
          {hasPrompt && (
            <div className="flex items-center justify-between">
              <span>Prompt đã quét:</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">✅ Có</span>
            </div>
          )}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting || chapterIds.length === 0 || needsPrompt}
          className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {submitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <UploadCloudIcon className="size-4" />
          )}
          <span>{submitting ? "Đang gửi..." : `Gửi ${chapterIds.length} chương lên hàng đợi`}</span>
        </Button>
      </div>

      {/* My jobs list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Các yêu cầu dịch của bạn</p>
          <div className="flex items-center gap-2">
             {myJobs.filter(j => j.status === 'translating').length > 0 && (
               <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 text-[10px] text-blue-500 font-medium border border-blue-500/20">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                  </span>
                  Đang chạy: {Array.from(new Set(myJobs.filter(j => j.status === 'translating').map(j => j.worker_name).filter(Boolean))).length} AI
               </div>
             )}
            <Button variant="ghost" size="icon-sm" onClick={loadJobs} title="Làm mới">
              <RefreshCwIcon className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {loading && myJobs.length === 0 ? (
          <div className="text-center py-4 text-xs text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin mx-auto mb-1" />
            Đang tải...
          </div>
        ) : myJobs.length === 0 ? (
          <div className="text-center py-4 text-xs text-muted-foreground">
            Chưa có yêu cầu dịch nào. Gửi truyện lên để bắt đầu!
          </div>
        ) : (
          <Tabs defaultValue="AI-1" className="w-full">
            <TabsList className="grid w-full grid-cols-5 h-9 bg-muted/50 p-1">
              {["AI-1", "AI-2", "AI-3", "AI-4", "AI-5"].map(name => {
                const activeJobs = myJobs.filter(j => j.assigned_worker === name && (j.status === 'pending' || j.status === 'translating'));
                const isRunning = activeJobs.some(j => j.status === 'translating');
                const count = activeJobs.length;
                
                return (
                  <TabsTrigger key={name} value={name} className="text-[9px] py-1 px-0 flex flex-col gap-0.5 relative">
                    <span className="flex items-center gap-1">
                      <span className={`size-1.5 rounded-full ${isRunning ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
                      {name}
                    </span>
                    {count > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-[8px] font-bold text-white shadow-sm">
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            
            {["AI-1", "AI-2", "AI-3", "AI-4", "AI-5"].map(name => (
              <TabsContent key={name} value={name} className="space-y-2 mt-2 max-h-[250px] overflow-y-auto pr-1">
                {myJobs.filter(j => j.assigned_worker === name || (!j.assigned_worker && name === "AI-1")).length === 0 ? (
                  <div className="text-center py-4 text-[10px] text-muted-foreground italic border border-dashed rounded-lg">
                    Slot này đang trống
                  </div>
                ) : (
                  myJobs.filter(j => j.assigned_worker === name || (!j.assigned_worker && name === "AI-1")).map((job) => {
                    const statusInfo = STATUS_MAP[job.status] || STATUS_MAP.pending;
                    const progress = job.chapter_count > 0 ? (job.current_chapter / job.chapter_count) * 100 : 0;

                    return (
                      <div key={job.id} className="rounded-lg border bg-card p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate">{job.novel_name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {job.chapter_count} chương • {MODE_LABELS[job.translate_mode] || job.translate_mode}
                              {job.prompt_type === "custom" || job.custom_prompt ? " • Có Prompt riêng" : ""}
                              {job.extract_dict ? " • Học từ vựng (Bật)" : ""}
                              {" • "}{new Date(job.created_at).toLocaleString("vi-VN")}
                            </p>
                            {job.status === "translating" && (
                              <div className="mt-1 flex items-center gap-1.5">
                                <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-600 bg-blue-50/50">
                                   AI: {job.worker_name || "Chưa xác định"}
                                </Badge>
                              </div>
                            )}
                          </div>
                          <Badge className={`text-[10px] gap-1 shrink-0 ${statusInfo.color}`}>
                            {statusInfo.icon}
                            {statusInfo.label}
                          </Badge>
                        </div>

                        {job.status === "translating" && (
                          <div className="space-y-1">
                            <Progress value={progress} className="h-1.5" />
                            <p className="text-[10px] text-muted-foreground text-right">
                              <span>{job.current_chapter}</span>/<span>{job.chapter_count}</span> chương
                            </p>
                          </div>
                        )}

                        {job.error_message && (
                          <p className="text-[10px] text-destructive bg-destructive/10 rounded p-1.5">{job.error_message}</p>
                        )}

                        <div className="flex gap-1.5">
                          {job.status === "completed" && (
                            <Button
                              size="sm" variant="default"
                              className="flex-1 h-7 text-[10px] gap-1 bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => {
                                let url = "";
                                if (job.error_message?.includes("output_drive_id:")) {
                                   url = job.error_message.split("output_drive_id:")[1];
                                }
                                handleImportResult(job.id, url);
                              }}
                              disabled={importingJobId === job.id}
                            >
                              {importingJobId === job.id ? <Loader2Icon className="size-3 animate-spin" /> : <DownloadIcon className="size-3" />}
                              <span>Nạp thủ công</span>
                            </Button>
                          )}
                          {job.status === "pending" && (
                            <Button size="sm" variant="destructive" className="flex-1 h-7 text-[10px] gap-1" onClick={() => handleCancel(job.id)}>
                              <TrashIcon className="size-3" /> <span>Hủy yêu cầu</span>
                            </Button>
                          )}
                          {job.status !== "pending" && job.status !== "translating" && (
                            <Button size="sm" variant="outline" className="flex-1 h-7 text-[10px] gap-1 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteJob(job.id)}>
                              <TrashIcon className="size-3" /> <span>Xóa khỏi danh sách</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}
