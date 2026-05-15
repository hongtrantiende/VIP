"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useApiInferenceProviders, useAIModels } from "@/lib/hooks/use-ai-providers";
import { getModel } from "@/lib/ai/provider";
import { runQtAiTranslate } from "@/lib/chapter-tools/qt-ai-translate";
import { runHybridTranslate } from "@/lib/chapter-tools/hybrid-translate";
import { bulkImportNameEntries, getMergedNameDict } from "@/lib/hooks/use-name-entries";
import { createSceneVersion, ensureInitialVersion } from "@/lib/hooks/use-scene-versions";
import { useProfile } from "@/lib/hooks/use-profile";
import {
  BotIcon, PlayIcon, PauseIcon, SkipForwardIcon, Loader2Icon, RefreshCwIcon,
  CheckCircle2Icon, XCircleIcon, ClockIcon, TrashIcon, AlertTriangleIcon,
} from "lucide-react";

interface QueueJob {
  id: string; user_email: string; novel_name: string; novel_genre: string | null;
  chapter_count: number; status: string; current_chapter: number;
  translate_mode: string; created_at: string; error_message: string | null;
  dict_sources: string[]; custom_prompt: string | null; prompt_type: string;
  extract_dict: boolean; name_dict: any[];
}

interface SlotConfig {
  providerId: string; modelId: string; running: boolean;
}

const SLOT_NAMES = ["Slot 1", "Slot 2", "Slot 3", "Slot 4", "Slot 5"];

export default function BotTranslatePage() {
  const { isAdmin } = useProfile();
  const providers = useApiInferenceProviders();
  const [mounted, setMounted] = useState(false);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);
  const [activeSlot, setActiveSlot] = useState("0");
  const [slots, setSlots] = useState<SlotConfig[]>(
    SLOT_NAMES.map(() => ({ providerId: "", modelId: "", running: false }))
  );
  const [processingJobId, setProcessingJobId] = useState<Record<number, string | null>>({});
  const [slotProgress, setSlotProgress] = useState<Record<number, { current: number; total: number; title: string }>>({});
  const [slotLogs, setSlotLogs] = useState<Record<number, string[]>>({});
  const abortRefs = useRef<Record<number, AbortController | null>>({});

  // Load saved slot configs from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bot_slot_configs");
      if (saved) setSlots(JSON.parse(saved));
    } catch {}
  }, []);

  const saveSlots = (newSlots: SlotConfig[]) => {
    setSlots(newSlots);
    localStorage.setItem("bot_slot_configs", JSON.stringify(newSlots));
  };

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/bot-translate/queue?all=true");
      const data = await res.json();
      if (data.jobs) setJobs(data.jobs);
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (mounted) loadJobs();
    const i = setInterval(() => {
      if (mounted) loadJobs();
    }, 10000);
    return () => clearInterval(i);
  }, [loadJobs, mounted]);


  const addLog = (slotIdx: number, msg: string) => {
    setSlotLogs(prev => ({ ...prev, [slotIdx]: [...(prev[slotIdx] || []).slice(-50), `[${new Date().toLocaleTimeString("vi-VN")}] ${msg}`] }));
  };

  const updateJobStatus = async (jobId: string, status: string, extra?: Record<string, any>) => {
    await fetch("/api/bot-translate/queue", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, status, ...extra }),
    });
  };

  const uploadChapterResult = async (jobId: string, chapterQueueId: string, translatedTitle: string, translatedScenes: any[]) => {
    const supabase = (await import("@/lib/supabase/client")).createClient();
    await supabase.from("translation_queue_chapters").update({
      translated_title: translatedTitle,
      translated_scenes: translatedScenes,
      status: "completed",
    }).eq("id", chapterQueueId);
  };

  const processJob = async (slotIdx: number, job: QueueJob) => {
    // Fetch latest slot config to avoid stale state in closures
    const currentSlotsRaw = localStorage.getItem("bot_slot_configs");
    let slot = slots[slotIdx]; // fallback
    if (currentSlotsRaw) {
      const parsed = JSON.parse(currentSlotsRaw);
      if (parsed && parsed[slotIdx]) slot = parsed[slotIdx];
    }

    if (!slot.providerId || !slot.modelId) {
      addLog(slotIdx, "❌ Chưa cấu hình model cho slot này!");
      return;
    }

    const controller = new AbortController();
    abortRefs.current[slotIdx] = controller;
    setProcessingJobId(prev => ({ ...prev, [slotIdx]: job.id }));
    addLog(slotIdx, `📖 Bắt đầu dịch: "${job.novel_name}" (${job.chapter_count} chương)`);

    try {
      await updateJobStatus(job.id, "translating");

      // Get input file ID
      let inputDriveId = "";
      if (job.error_message?.includes("input_drive_id:")) {
        inputDriveId = job.error_message.split("input_drive_id:")[1];
      }
      if (!inputDriveId) throw new Error("Job không có input_drive_id");

      // Download input JSON
      addLog(slotIdx, `⬇️ Đang tải nội dung truyện từ kho...`);
      const dlRes = await fetch(`/api/bot-translate/queue/download?fileId=${inputDriveId}`);
      if (!dlRes.ok) throw new Error("Không thể tải file đầu vào từ kho");
      const fullData = await dlRes.json();
      
      const queueChapters = fullData.chapters;
      if (!queueChapters || !Array.isArray(queueChapters)) throw new Error("Dữ liệu chương không hợp lệ");

      const dbProvider = await db.aiProviders.get(slot.providerId);
      if (!dbProvider) throw new Error("Provider không tồn tại trong máy");

      const model = await getModel(dbProvider, slot.modelId);

      // Create temp novel in IndexedDB
      const tempNovelId = `bot_temp_${job.id}`;
      await db.novels.put({
        id: tempNovelId, title: job.novel_name, description: "",
        customTranslatePrompt: job.custom_prompt || undefined,
        genre: job.novel_genre || undefined,
        createdAt: new Date(), updatedAt: new Date(),
      });

      // Import name dict
      if (fullData.nameDict && fullData.nameDict.length > 0) {
        await bulkImportNameEntries(tempNovelId, fullData.nameDict.map((n: any) => ({
          chinese: n.chinese, vietnamese: n.vietnamese, category: "nhân vật", dictType: "names",
        })), "khác", "skip");
      }

      const translatedChaptersData: any[] = [];
      const allTempChapterIds: string[] = [];

      // 1. Bulk insert all chapters into IndexedDB
      for (let i = 0; i < queueChapters.length; i++) {
        const qCh = queueChapters[i];
        const chapterTitle = qCh.title || `Chương ${i + 1}`;
        const tempChapterId = `bot_ch_${i}`;
        allTempChapterIds.push(tempChapterId);

        await db.chapters.put({
          id: tempChapterId, novelId: tempNovelId, title: chapterTitle,
          order: qCh.order || (i + 1), createdAt: new Date(), updatedAt: new Date(),
        });

        const sceneData = qCh.scenes || [];
        for (const sc of sceneData) {
          const tempSceneId = `bot_sc_${i}_${sc.order}`;
          await db.scenes.put({
            id: tempSceneId, chapterId: tempChapterId, novelId: tempNovelId,
            title: `Scene ${sc.order}`, content: sc.content,
            order: sc.order, wordCount: typeof sc.content === "string" ? sc.content.split(/\s+/).length : 0,
            version: 1, versionType: "manual", isActive: 1, 
            createdAt: new Date(), updatedAt: new Date(),
          });
        }
      }

      // 2. Run Bulk Translation Engine
      const translateOpts = {
        novelId: tempNovelId, chapterIds: allTempChapterIds, model,
        qtDictSources: job.dict_sources || ["tienhiep"],
        promptType: (job.prompt_type || "khuyen_nghi") as any,
        extractDict: job.extract_dict || false,
        skipTranslated: false, signal: controller.signal, delayMs: 1000,
        onPhase: () => {},
        onChapterStart: async (chapterId: string, chapterTitle: string) => {
          const idx = allTempChapterIds.indexOf(chapterId);
          if (idx !== -1) {
            setSlotProgress(prev => ({ ...prev, [slotIdx]: { current: idx + 1, total: queueChapters.length, title: chapterTitle } }));
            addLog(slotIdx, `📝 [${idx + 1}/${queueChapters.length}] ${chapterTitle}`);
            await updateJobStatus(job.id, "translating", { currentChapter: idx + 1 });
          }
        },
        onChapterComplete: (res: any) => {
           addLog(slotIdx, `✅ Hoàn thành: ${res?.chapterTitle || 'Chương'}`);
        },
        onChapterError: (err: any) => { 
           addLog(slotIdx, `⚠️ Lỗi: ${err.message}`); 
        },
        onAllComplete: () => {},
      };

      try {
        if (job.translate_mode === "stv-hybrid") {
          await runHybridTranslate(translateOpts);
        } else {
          await runQtAiTranslate(translateOpts);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          addLog(slotIdx, `⚠️ Lỗi trong quá trình dịch: ${err.message}`);
        }
      }

      // 3. Collect Results
      for (let i = 0; i < queueChapters.length; i++) {
        const qCh = queueChapters[i];
        const tempChapterId = allTempChapterIds[i];
        const dbChapter = await db.chapters.get(tempChapterId);
        
        const translatedScenes = [];
        const dbScenes = await db.scenes.where("chapterId").equals(tempChapterId).sortBy("order");
        
        let hasTranslated = false;
        for (const s of dbScenes) {
          const origScene = qCh.scenes.find((sc: any) => sc.order === s.order);
          if (origScene && origScene.content !== s.content) {
            hasTranslated = true;
          }
          translatedScenes.push({ order: s.order, content: s.content });
        }

        if (hasTranslated) {
          translatedChaptersData.push({
            order: qCh.order || (i + 1),
            translated_title: dbChapter?.title || qCh.title,
            translated_scenes: translatedScenes,
            status: "completed"
          });
        } else {
          translatedChaptersData.push({
            order: qCh.order || (i + 1),
            status: "failed",
            error_message: "Chưa dịch thành công"
          });
        }

        // Cleanup temp chapter data
        await db.scenes.where("chapterId").equals(tempChapterId).delete();
        await db.chapters.delete(tempChapterId);
      }

      // Cleanup temp novel
      await db.novels.delete(tempNovelId);

      const rawFinal = localStorage.getItem("bot_slot_configs");
      let isRunningFinal = slots[slotIdx].running;
      if (rawFinal) {
        isRunningFinal = JSON.parse(rawFinal)[slotIdx]?.running;
      }

      if (!controller.signal.aborted && isRunningFinal) {
        addLog(slotIdx, `⏳ Đang đóng gói kết quả và tải lên kho...`);
        // Lấy từ điển mới (nếu bot có học thêm từ)
        const newNameDict = await getMergedNameDict(tempNovelId);

        // Tự động đồng bộ lên Kho Tổng
        if (job.extract_dict && job.novel_genre && newNameDict.length > 0) {
          addLog(slotIdx, `☁️ Đang tự động đồng bộ từ vựng mới lên Kho Tổng...`);
          try {
            const genreSource = `${job.novel_genre}_names`;
            const filename = `${genreSource}.txt`;
            
            // Tải bản hiện tại trên Kho về để gộp
            const dlParams = new URLSearchParams({ action: 'download-dict', filename });
            const dlRes = await fetch(`/api/dict/cloud-storage?${dlParams.toString()}`, { method: 'POST' });
            
            let cloudText = "";
            if (dlRes.ok) {
              cloudText = await dlRes.text();
            }

            // Gộp từ điển
            const novelEntries = await db.nameEntries.where("scope").equals(tempNovelId).toArray();
            const map = new Map<string, Set<string>>();
            
            const addToMap = (chinese: string, vietnamese: string) => {
              const key = chinese.trim();
              if (!key) return;
              const meanings = vietnamese.split("/").map(m => m.trim()).filter(Boolean);
              if (!map.has(key)) map.set(key, new Set());
              meanings.forEach(m => map.get(key)!.add(m));
            };

            cloudText.split(/\r?\n/).forEach(line => {
              const idx = line.indexOf("=");
              if (idx > 0) addToMap(line.slice(0, idx), line.slice(idx + 1));
            });
            novelEntries.forEach(e => addToMap(e.chinese, e.vietnamese));

            const finalContent = Array.from(map.entries())
              .map(([k, vs]) => `${k}=${Array.from(vs).join("/")}`)
              .join("\n");

            // Tải lên phân mảnh (Chunk Upload)
            const lines = finalContent.split("\n");
            const CHUNK_LINES = 50000;
            const chunks = [];
            for (let i = 0; i < lines.length; i += CHUNK_LINES) {
              const isLastChunk = i + CHUNK_LINES >= lines.length;
              chunks.push(lines.slice(i, i + CHUNK_LINES).join("\n") + (isLastChunk ? "" : "\n"));
            }

            for (let i = 0; i < chunks.length; i++) {
              const res = await fetch("/api/dict/chunk-upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  filename,
                  chunk: chunks[i],
                  index: i,
                  total: chunks.length
                })
              });
              if (!res.ok) throw new Error(`Upload phần ${i+1} thất bại`);
            }
            addLog(slotIdx, `✅ Đã đồng bộ ${novelEntries.length} từ mới lên Tổng Kho (${genreSource})!`);
          } catch (syncErr: any) {
            addLog(slotIdx, `⚠️ Lỗi đồng bộ Kho Tổng: ${syncErr.message}`);
          }
        }

        const outputPayload = {
          chapters: translatedChaptersData,
          name_dict: newNameDict.map(n => ({ chinese: n.chinese, vietnamese: n.vietnamese })),
        };
        
        const outputFileName = `job_${job.id}_output.json`;
        const uploadRes = await fetch("/api/bot-translate/queue/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: outputFileName, content: JSON.stringify(outputPayload) }),
        });
        
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(`Lỗi tải file kết quả: ${uploadData.error}`);

        await updateJobStatus(job.id, "completed", { errorMessage: `output_drive_id:${uploadData.fileId}` });
        addLog(slotIdx, `🎉 Hoàn thành toàn bộ: "${job.novel_name}"`);
        
        // Tùy chọn: Xóa file input để dọn dẹp (đã gọi API xóa)
        fetch(`/api/bot-translate/queue/upload`, { method: "DELETE", body: JSON.stringify({ fileId: inputDriveId }) }).catch(() => {});
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        addLog(slotIdx, `💥 Lỗi nghiêm trọng: ${err.message}`);
        await updateJobStatus(job.id, "failed", { errorMessage: err.message });
      }
    } finally {
      setProcessingJobId(prev => ({ ...prev, [slotIdx]: null }));
      setSlotProgress(prev => { const n = { ...prev }; delete n[slotIdx]; return n; });
      abortRefs.current[slotIdx] = null;
    }
  };

  // Auto-process loop for a slot
  const runSlotLoop = useCallback(async (slotIdx: number) => {
    while (true) {
      // Check current slot state directly from localStorage/state ref equivalent
      const currentSlotsRaw = localStorage.getItem("bot_slot_configs");
      let isRunning = false;
      if (currentSlotsRaw) {
        const parsed = JSON.parse(currentSlotsRaw);
        isRunning = parsed[slotIdx]?.running;
      }
      
      if (!isRunning) break;

      try {
        const slotName = SLOT_NAMES[slotIdx];
        const res = await fetch(`/api/bot-translate/queue?all=true&status=pending&assignedWorker=${slotName}`);
        if (!res.ok) throw new Error("Lỗi fetch queue");
        const data = await res.json();
        const pendingJobs = (data.jobs || []).filter((j: QueueJob) => j.status === "pending");

        if (pendingJobs.length === 0) {
          addLog(slotIdx, "⏳ Không có truyện ở hàng đợi. Chờ 15s...");
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }

        await processJob(slotIdx, pendingJobs[0]);
      } catch (err: any) {
        addLog(slotIdx, `⚠️ Lỗi check hàng đợi: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }, []);

  const toggleSlot = (slotIdx: number) => {
    const newSlots = [...slots];
    newSlots[slotIdx] = { ...newSlots[slotIdx], running: !newSlots[slotIdx].running };
    saveSlots(newSlots);

    if (newSlots[slotIdx].running) {
      addLog(slotIdx, "▶️ Bot đã bắt đầu chạy!");
      // Need a small timeout so localStorage updates first
      setTimeout(() => runSlotLoop(slotIdx), 100);
    } else {
      addLog(slotIdx, "⏸️ Bot đã tạm dừng.");
      abortRefs.current[slotIdx]?.abort();
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm("Xóa job này?")) return;
    await fetch(`/api/bot-translate/queue?jobId=${jobId}`, { method: "DELETE" });
    toast.success("Đã xóa!");
    loadJobs();
  };

  if (!isAdmin) {
    return <div className="flex h-full items-center justify-center p-8"><p className="text-muted-foreground">Chỉ Admin mới được truy cập.</p></div>;
  }

  const SlotPanel = ({ slotIdx }: { slotIdx: number }) => {
    const slot = slots[slotIdx];
    const models = useAIModels(slot.providerId || undefined);
    const progress = slotProgress[slotIdx];
    const logs = slotLogs[slotIdx] || [];
    const currentJobId = processingJobId[slotIdx];

    return (
      <div className="space-y-4">
        {/* Model config */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">Cấu hình Model cho {SLOT_NAMES[slotIdx]}</p>
          <div className="grid grid-cols-2 gap-2">
            <Select value={slot.providerId} onValueChange={(v) => {
              const ns = [...slots]; ns[slotIdx] = { ...ns[slotIdx], providerId: v, modelId: "" }; saveSlots(ns);
            }}>
              <SelectTrigger><SelectValue placeholder="Provider..." /></SelectTrigger>
              <SelectContent>{providers?.filter(p => p.id !== "admin-provider").map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}</SelectContent>
            </Select>
            <Select value={slot.modelId} onValueChange={(v) => {
              const ns = [...slots]; ns[slotIdx] = { ...ns[slotIdx], modelId: v }; saveSlots(ns);
            }}>
              <SelectTrigger><SelectValue placeholder="Model..." /></SelectTrigger>
              <SelectContent>{models?.map(m => (
                <SelectItem key={m.id} value={m.modelId}>{m.name || m.modelId}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => toggleSlot(slotIdx)}
            className={`w-full gap-2 ${slot.running ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} text-white`}
            disabled={!slot.providerId || !slot.modelId}
          >
            {slot.running ? <><PauseIcon className="size-4" /> <span>Dừng Bot</span></> : <><PlayIcon className="size-4" /> <span>Bắt đầu Bot</span></>}
          </Button>
        </div>

        {/* Progress */}
        {progress && (
          <div className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5"><Loader2Icon className="size-3.5 animate-spin text-blue-500" /><span>{progress.title}</span></span>
              <span className="font-mono"><span>{progress.current}</span>/<span>{progress.total}</span></span>
            </div>
            <Progress value={(progress.current / progress.total) * 100} className="h-1.5" />
          </div>
        )}

        {/* Logs */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-1 max-h-[300px] overflow-y-auto">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase">Log</p>
          {logs.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Chưa có hoạt động...</p>
          ) : logs.map((l, i) => (
            <p key={i} className="text-[10px] font-mono text-muted-foreground leading-relaxed">{l}</p>
          ))}
        </div>
      </div>
    );
  };

  if (!mounted) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BotIcon className="size-6 text-blue-500" /> Bot Dịch Tự Động</h1>
        <Button variant="outline" size="sm" onClick={loadJobs}><RefreshCwIcon className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Làm mới</Button>
      </div>

      {/* 5 Slot Tabs */}
      <Tabs value={activeSlot} onValueChange={setActiveSlot}>
        <TabsList className="grid w-full grid-cols-5">
          {SLOT_NAMES.map((name, i) => (
            <TabsTrigger key={i} value={String(i)} className="gap-1.5 text-xs">
              {slots[i].running && <span className="size-2 rounded-full bg-green-500 animate-pulse" />}
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
        {SLOT_NAMES.map((_, i) => (
          <TabsContent key={i} value={String(i)}><SlotPanel slotIdx={i} /></TabsContent>
        ))}
      </Tabs>

      {/* Queue */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Hàng đợi ({jobs.length})</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Chưa có yêu cầu dịch nào.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => {
              const progress = job.chapter_count > 0 ? (job.current_chapter / job.chapter_count) * 100 : 0;
              return (
                <div key={job.id} className="rounded-lg border bg-card p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{job.novel_name}</p>
                    <p className="text-[10px] text-muted-foreground">{job.user_email} • {job.chapter_count} chương • {new Date(job.created_at).toLocaleString("vi-VN")}</p>
                    {job.status === "translating" && <Progress value={progress} className="h-1 mt-1.5" />}
                    {job.error_message && <p className="text-[10px] text-destructive mt-1">{job.error_message}</p>}
                  </div>
                  <Badge className={`shrink-0 text-[10px] ${
                    job.status === "pending" ? "bg-yellow-100 text-yellow-800" :
                    job.status === "translating" ? "bg-blue-100 text-blue-800" :
                    job.status === "completed" ? "bg-green-100 text-green-800" :
                    "bg-red-100 text-red-800"
                  }`}>
                    {job.status === "pending" ? <span>Chờ</span> : job.status === "translating" ? <span>Đang dịch {job.current_chapter}/{job.chapter_count}</span> : job.status === "completed" ? <span>Xong</span> : <span>Lỗi</span>}
                  </Badge>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleDeleteJob(job.id)} title="Xóa"><TrashIcon className="size-3.5 text-destructive" /></Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
