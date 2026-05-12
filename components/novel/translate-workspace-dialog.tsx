"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { db, type Chapter } from "@/lib/db";
import { runQtAiTranslate, type PromptType } from "@/lib/chapter-tools/qt-ai-translate";
import { runHybridTranslate } from "@/lib/chapter-tools/hybrid-translate";
import type { HybridTranslateResult, HybridTranslateError } from "@/lib/chapter-tools/hybrid-translate";
import { PromptTunerDialog } from "@/components/novel/prompt-tuner-dialog";
import { scanNovelStyle } from "@/lib/chapter-tools/scan-novel-style";
import { useAnalysisSettings } from "@/lib/hooks/use-analysis-settings";
import { useChatSettings } from "@/lib/hooks/use-chat-settings";
import {
  useAIProvider,
  useApiInferenceProviders,
  useAIModels,
} from "@/lib/hooks/use-ai-providers";
import {
  resolveChapterToolModel,
  getChapterToolModelMissingMessage,
} from "@/lib/chapter-tools/stream-runner";
import type { StepModelConfig } from "@/lib/db";
import {
  CheckCircle2Icon,
  Loader2Icon,
  XCircleIcon,
  BookOpenIcon,
  SparklesIcon,
  ZapIcon,
  ArrowRightIcon,
  ScanSearchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  TagIcon,
  TrendingUpIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDictMeta } from "@/lib/hooks/use-dict-entries";
import { useProfile } from "@/lib/hooks/use-profile";
import { cn } from "@/lib/utils";

type Phase = "idle" | "dict" | "ai" | "done";

export function TranslateWorkspaceDialog({
  open,
  onOpenChange,
  novelId,
  chapterIds,
  chapters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novelId: string;
  chapterIds: string[];
  chapters: Chapter[];
}) {
  const { profile } = useProfile();
  const [step, setStep] = useState<"config" | "processing" | "done">("config");
  const [processedCount, setProcessedCount] = useState(0);
  const [errors, setErrors] = useState<HybridTranslateError[]>([]);
  const [results, setResults] = useState<HybridTranslateResult[]>([]);
  const [currentPhase, setCurrentPhase] = useState<Phase>("idle");
  const [currentChapterTitle, setCurrentChapterTitle] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [tunerOpen, setTunerOpen] = useState(false);
  const [qtDictSources, setQtDictSources] = useState<string[]>(["tienhiep"]);
  const [confirmMode, setConfirmMode] = useState<"khuyen_nghi" | "cuc_ngan" | "custom" | null>(null);
  const [activeTab, setActiveTab] = useState<string>("hybrid");
  const [extractDict, setExtractDict] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const GENRE_DICTS = [
    "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong", 
    "dothi", "vongdu", "dongnhan", "ngontinh"
  ];
  
  const GENRE_LABELS: Record<string, string> = {
    hiendai: "Hiện đại", tienhiep: "Tiên hiệp", huyenhuyen: "Huyền huyễn",
    dammi: "Đam mỹ", hocduong: "Học đường", dothi: "Đô thị",
    vongdu: "Võng du", dongnhan: "Đồng nhân", ngontinh: "Ngôn tình"
  };

  const dictMeta = useDictMeta();
  const dynamicGenres = useMemo(() => {
    if (!dictMeta) return [];
    const genres = new Set<string>();
    for (const source of Object.keys(dictMeta.sources)) {
      const g = source.split("_")[0];
      if (g && g !== "core" && !GENRE_DICTS.includes(g)) {
        genres.add(g);
      }
    }
    return Array.from(genres);
  }, [dictMeta]);
  const allGenreSources = [...GENRE_DICTS, ...dynamicGenres];

  const settings = useAnalysisSettings();
  const chatSettings = useChatSettings();
  const providers = useApiInferenceProviders();
  const defaultProvider = useAIProvider(chatSettings?.providerId);

  // Per-novel model settings
  const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);
  
  // Auto-detect genre and set as default dictionary
  useEffect(() => {
    if (novel?.genre) {
      const gLower = novel.genre.toLowerCase();
      let matchedKey = "tienhiep"; // fallback
      for (const [key, label] of Object.entries(GENRE_LABELS)) {
        if (gLower === label.toLowerCase() || gLower.includes(label.toLowerCase())) {
          matchedKey = key;
          break;
        }
      }
      setQtDictSources([matchedKey]);
    }
  }, [novel?.genre]);
  const currentModel = useMemo(() => {
    if (novel?.customTranslateProviderId) {
      return {
        providerId: novel.customTranslateProviderId,
        modelId: novel.customTranslateModelId || "",
      };
    }
    return settings.translateModel as StepModelConfig | undefined;
  }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel]);

  const selectedProviderId = currentModel?.providerId ?? "";
  const models = useAIModels(selectedProviderId || undefined);

  const currentVnDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"})).toDateString();
  const rawQuota = (profile as any)?.admin_model_quota || 0;
  const dailyLimit = (profile as any)?.admin_daily_quota_limit || 0;
  const lastReset = (profile as any)?.admin_quota_last_reset || "";
  const displayQuota = (lastReset !== currentVnDate && dailyLimit > 0) ? dailyLimit : rawQuota;

  const handleProviderChange = async (providerId: string) => {
    await db.novels.update(novelId, {
      customTranslateProviderId: providerId,
      customTranslateModelId: "",
    });
  };
  const handleModelChange = async (modelId: string) => {
    if (!selectedProviderId) return;
    await db.novels.update(novelId, {
      customTranslateModelId: modelId,
    });
  };

  const resolveModel = useCallback(async () => {
    let activeModel = novel?.customTranslateProviderId
      ? { providerId: novel.customTranslateProviderId, modelId: novel.customTranslateModelId || "" }
      : settings.translateModel;

    // Ưu tiên tuyệt đối dùng Admin Model nếu còn lượt (Không cần quan tâm họ có chọn AI hay không)
    if (displayQuota > 0) {
      activeModel = { providerId: "admin-provider", modelId: "admin-model" };
    }

    const model = await resolveChapterToolModel(
      activeModel,
      defaultProvider,
      chatSettings,
    );
    
    // Nếu giải quyết model lỗi, nhưng user vẫn còn lượt, thì ép dùng Admin Model
    if (!model && displayQuota > 0) {
      return await resolveChapterToolModel(
        { providerId: "admin-provider", modelId: "admin-model" },
        defaultProvider,
        chatSettings
      );
    }

    if (!model) {
      toast.error(getChapterToolModelMissingMessage(defaultProvider));
    }
    return model;
  }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel, defaultProvider, chatSettings, profile]);

  // ── Scan novel style ──
  const handleScan = useCallback(async () => {
    const model = await resolveModel();
    if (!model) return;

    setIsScanning(true);
    setScanProgress("Bắt đầu quét...");

    try {
      const result = await scanNovelStyle(novelId, model, undefined, (msg) => {
        setScanProgress(msg);
      });
      toast.success("Đã quét phong cách + trích xuất tên thành công!");
    } catch (err: any) {
      toast.error("Quét thất bại: " + err.message);
    } finally {
      setIsScanning(false);
      setScanProgress("");
    }
  }, [novelId, resolveModel]);

  // ── Save edited prompt ──
  const handleSavePrompt = async () => {
    await db.novels.update(novelId, {
      customTranslatePrompt: promptDraft.trim(),
      updatedAt: new Date(),
    });
    setEditingPrompt(false);
    toast.success("Đã lưu prompt!");
  };

  const handleStart = useCallback(async (promptType: PromptType = "legacy") => {
    const model = await resolveModel();
    if (!model) return;

    setStep("processing");
    setProcessedCount(0);
    setErrors([]);
    setResults([]);
    setCurrentPhase("idle");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (activeTab === "stv-hybrid") {
        await runHybridTranslate({
          novelId,
          chapterIds,
          model,
          extractDict,
          signal: controller.signal,
          delayMs: (settings.translateDelaySeconds ?? 0) * 1000,
          onPhase: (_chapterId, phase) => {
            setCurrentPhase(phase as Phase);
          },
          onChapterStart: (_chapterId, title) => {
            setCurrentChapterTitle(title);
          },
          onChapterComplete: (result) => {
            setResults((prev) => [...prev, result as any]);
            setProcessedCount((c) => c + 1);
          },
          onChapterError: (error) => {
            setErrors((prev) => [...prev, error as any]);
            setProcessedCount((c) => c + 1);
          },
          onAllComplete: () => {
            if (!controller.signal.aborted) {
              setStep("done");
            }
          },
        });
      } else {
        await runQtAiTranslate({
          novelId,
          chapterIds,
          model,
          qtDictSources,
          promptType,
          extractDict,
          signal: controller.signal,
          delayMs: (settings.translateDelaySeconds ?? 0) * 1000,

          onPhase: (_chapterId, phase) => {
            setCurrentPhase(phase as Phase);
          },
          onChapterStart: (_chapterId, title) => {
            setCurrentChapterTitle(title);
          },
          onChapterComplete: (result) => {
            setResults((prev) => [...prev, result as any]);
            setProcessedCount((c) => c + 1);
          },
          onChapterError: (error) => {
            setErrors((prev) => [...prev, error as any]);
            setProcessedCount((c) => c + 1);
          },
          onAllComplete: () => {
            if (!controller.signal.aborted) {
              setStep("done");
            }
          },
        });
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast.error("Lỗi hệ thống: " + err.message);
        setStep("config");
      }
    }
  }, [novelId, chapterIds, settings, resolveModel]);

  const handleClose = () => {
    if (step === "processing") {
      abortRef.current?.abort();
    }
    setStep("config");
    setProcessedCount(0);
    setErrors([]);
    setResults([]);
    setCurrentPhase("idle");
    setEditingPrompt(false);
    onOpenChange(false);
  };

  const progress = chapterIds.length > 0 ? (processedCount / chapterIds.length) * 100 : 0;
  const hasCustomPrompt = !!novel?.customTranslatePrompt?.trim();
  const hasScanned = !!novel?.styleScannedAt;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ZapIcon className="size-5 text-primary" />
            Khu Vực Dịch Truyện (Gốc + Thô + AI)
          </DialogTitle>
          <DialogDescription>
            Dịch bằng từ điển cục bộ (QT) + AI sửa lỗi thông minh. Rất nhanh, mượt và tiết kiệm Token.
          </DialogDescription>
        </DialogHeader>

        {step === "config" && (
          <div className="space-y-4 py-2">
            <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setConfirmMode(null); }} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="hybrid">Gốc + Thô + AI</TabsTrigger>
                <TabsTrigger value="stv-hybrid">Converter AI</TabsTrigger>
                <TabsTrigger value="pure-ai">Dịch thuần AI</TabsTrigger>
              </TabsList>

              <TabsContent value="stv-hybrid" className="space-y-4 mt-4">
                <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-primary">Quy trình Converter AI (Dùng dữ liệu từ SangTacViet)</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      <BookOpenIcon className="size-3" />
                      Từ điển STV
                    </span>
                    <ArrowRightIcon className="size-3" />
                    <span className="flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-blue-700 dark:text-blue-400 font-medium">
                      <SparklesIcon className="size-3" />
                      AI sửa lỗi
                    </span>
                    <ArrowRightIcon className="size-3" />
                    <span className="text-[10px]">Bản dịch hoàn thiện</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Phương pháp này sử dụng API từ điển của SangTacViet để tạo bản dịch thô, sau đó AI sẽ làm mịn và chuẩn hóa lại. Thích hợp cho các truyện chưa có từ điển cục bộ.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="hybrid" className="space-y-4 mt-4">
                {/* Dict selection */}
                <div className="space-y-2">
                  <Label className="text-xs">Từ điển thể loại (Phase 1)</Label>
                  <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
                    {allGenreSources.map((src) => {
                      const isActive = qtDictSources.includes(src);
                      return (
                        <button
                          key={src}
                          type="button"
                          onClick={() => {
                            if (isActive) setQtDictSources(qtDictSources.filter(s => s !== src));
                            else setQtDictSources([...qtDictSources, src]);
                          }}
                          className={cn(
                            "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors border",
                            isActive 
                              ? "bg-primary text-primary-foreground border-primary" 
                              : "bg-background text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {isActive && <CheckCircle2Icon className="size-3" />}
                          {GENRE_LABELS[src] || src}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Architecture explainer */}
                <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-primary">Quy trình 2 giai đoạn (Tiết kiệm Token)</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      <BookOpenIcon className="size-3" />
                      Từ điển cục bộ
                    </span>
                    <ArrowRightIcon className="size-3" />
                    <span className="flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-blue-700 dark:text-blue-400 font-medium">
                      <SparklesIcon className="size-3" />
                      AI sửa lỗi
                    </span>
                    <ArrowRightIcon className="size-3" />
                    <span className="text-[10px]">Bản dịch hoàn thiện</span>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="pure-ai" className="space-y-4 mt-4">
                {/* Genre Scan Section */}
                <div className="rounded-lg border bg-card p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ScanSearchIcon className="size-4 text-amber-500" />
                      <span className="text-xs font-medium">Cấu hình Prompt Dịch</span>
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Mở công cụ quét 10 chương đầu để phân tích thể loại và tạo ra System Prompt tối ưu nhất cho riêng bộ truyện này.
                  </p>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 border-blue-500/50 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                    onClick={() => setTunerOpen(true)}
                  >
                    <SparklesIcon className="size-3.5" />
                    Mở cấu hình Prompt
                  </Button>
                </div>

                {/* Custom Prompt Section */}
                {hasCustomPrompt && (
                  <div className="rounded-lg border bg-card p-3 space-y-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-left"
                      onClick={() => {
                        setShowPrompt(!showPrompt);
                        if (!showPrompt && !editingPrompt) {
                          setPromptDraft(novel?.customTranslatePrompt || "");
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <FileTextIcon className="size-4 text-blue-500" />
                        <span className="text-xs font-medium">Prompt dịch thuật</span>
                      </div>
                      {showPrompt ? (
                        <ChevronUpIcon className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronDownIcon className="size-4 text-muted-foreground" />
                      )}
                    </button>

                    {showPrompt && (
                      <div className="space-y-2">
                        {editingPrompt ? (
                          <>
                            <Textarea
                              value={promptDraft}
                              onChange={(e) => setPromptDraft(e.target.value)}
                              className="min-h-[200px] text-[11px] font-mono leading-relaxed"
                              placeholder="Prompt dịch thuật..."
                            />
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingPrompt(false)}>
                                Hủy
                              </Button>
                              <Button size="sm" className="flex-1" onClick={handleSavePrompt}>
                                Lưu prompt
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="max-h-[200px] overflow-y-auto rounded-md bg-muted/50 p-2.5 text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground">
                              {novel?.customTranslatePrompt}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => {
                                setPromptDraft(novel?.customTranslatePrompt || "");
                                setEditingPrompt(true);
                              }}
                            >
                              Chỉnh sửa prompt
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Model selection */}
            <div className="space-y-2 border-t pt-4">
              <Label className="text-xs">AI Model (Dùng chung cho cả 2 chế độ)</Label>
              <div className="flex gap-2">
                <Select value={selectedProviderId} onValueChange={handleProviderChange}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Chọn Provider..." />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={currentModel?.modelId ?? ""}
                  onValueChange={handleModelChange}
                  disabled={!selectedProviderId}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Chọn Model..." />
                  </SelectTrigger>
                  <SelectContent>
                    {models?.map((m) => (
                      <SelectItem key={m.id} value={m.modelId}>
                        {m.name || m.modelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md bg-muted/50 p-2.5">
              <p className="text-sm">
                Sẽ dịch <strong>{chapterIds.length}</strong> chương đã chọn.
              </p>
            </div>

            {/* Action buttons pinned at the bottom depending on active tab */}
            {(activeTab === "hybrid" || activeTab === "stv-hybrid") && (
              <div className="space-y-2 mt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    onClick={() => {
                      if (confirmMode === "khuyen_nghi") handleStart("khuyen_nghi");
                      else setConfirmMode("khuyen_nghi");
                    }}
                    className={cn("w-full gap-2 transition-all", confirmMode === "khuyen_nghi" && "bg-amber-600 hover:bg-amber-700 text-white")}
                    disabled={!(displayQuota > 0 || (selectedProviderId && currentModel?.modelId))}
                  >
                    <ZapIcon className="size-4" />
                    {confirmMode === "khuyen_nghi" ? "Xác nhận dịch bằng chế độ này" : "Prompt Khuyến Nghị"}
                  </Button>
                  <Button
                    variant={confirmMode === "cuc_ngan" ? "default" : "secondary"}
                    onClick={() => {
                      if (confirmMode === "cuc_ngan") handleStart("cuc_ngan");
                      else setConfirmMode("cuc_ngan");
                    }}
                    className={cn("w-full gap-2 transition-all", confirmMode === "cuc_ngan" && "bg-amber-600 hover:bg-amber-700 text-white")}
                    disabled={!(displayQuota > 0 || (selectedProviderId && currentModel?.modelId))}
                  >
                    <ZapIcon className="size-4" />
                    {confirmMode === "cuc_ngan" ? "Xác nhận dịch bằng chế độ này" : "Prompt Cực Ngắn"}
                  </Button>
                </div>
              </div>
            )}

            {/* Càng dịch càng hay toggle — visible on all tabs */}
            <label className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 cursor-pointer transition-colors hover:bg-emerald-500/10">
                <Checkbox
                  checked={extractDict}
                  onCheckedChange={(checked) => setExtractDict(!!checked)}
                  className="mt-0.5 border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <TrendingUpIcon className="size-3.5" />
                    Càng dịch càng hay ✨
                  </span>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    AI sẽ trích xuất tên nhân vật, địa danh từ mỗi chương → lưu vào từ điển truyện → chương sau dịch chính xác hơn. Tự động gửi lên hệ thống.
                  </p>
                </div>
              </label>

            {activeTab === "pure-ai" && (
              <Button
                onClick={() => {
                  if (confirmMode === "custom") handleStart("custom");
                  else setConfirmMode("custom");
                }}
                className={cn("w-full gap-2 mt-2 transition-all", confirmMode === "custom" ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white")}
                disabled={(!(displayQuota > 0 || (selectedProviderId && currentModel?.modelId))) || !hasCustomPrompt}
                title={!hasCustomPrompt ? "Cần tạo System Prompt ở phần Cấu hình Prompt Dịch trước" : ""}
              >
                <SparklesIcon className="size-4" />
                {confirmMode === "custom" ? "Xác nhận dịch bằng chế độ này" : "Dịch bằng Prompt này"}
              </Button>
            )}

            {/* Hiển thị số lượt miễn phí */}
            {(displayQuota > 0) && (
              <div className="text-center mt-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-medium border border-blue-200 dark:border-blue-800">
                  <SparklesIcon className="size-3" />
                  Bạn còn {displayQuota} lượt dịch tự động miễn phí!
                </span>
              </div>
            )}
          </div>
        )}

        <PromptTunerDialog
          open={tunerOpen}
          onOpenChange={setTunerOpen}
          novelId={novelId}
        />

        {step === "processing" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2Icon className="size-4 animate-spin text-primary" />
                {currentChapterTitle ? (
                  <span className="truncate max-w-[200px]">{currentChapterTitle}</span>
                ) : (
                  "Đang xử lý..."
                )}
              </span>
              <span className="font-medium tabular-nums">
                {processedCount} / {chapterIds.length}
              </span>
            </div>

            <Progress value={progress} className="h-2" />

            {/* Phase indicator */}
            {currentPhase !== "idle" && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                {currentPhase === "dict" && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <BookOpenIcon className="size-3.5 animate-pulse" />
                    Giai đoạn 1: Dịch từ điển ({qtDictSources.join(", ")})...
                  </span>
                )}
                {currentPhase === "ai" && (
                  <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                    <SparklesIcon className="size-3.5 animate-pulse" />
                    Giai đoạn 2: AI đang sửa lỗi{hasCustomPrompt ? " (có prompt thể loại)" : ""}...
                  </span>
                )}
              </div>
            )}

            {errors.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-md bg-destructive/10 p-2 text-[10px] text-destructive">
                {errors.map((err, i) => (
                  <div key={i}>Chương &quot;{err.chapterTitle}&quot;: {err.message}</div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
                Ẩn xuống nền
              </Button>
              <Button variant="destructive" onClick={handleClose} className="w-full">
                Hủy bỏ
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-6 py-4 text-center">
            <div className="flex justify-center">
              {errors.length === chapterIds.length ? (
                <XCircleIcon className="size-12 text-destructive" />
              ) : (
                <CheckCircle2Icon className="size-12 text-emerald-500" />
              )}
            </div>
            <div>
              <p className="text-lg font-bold">
                {errors.length === 0 ? "Hoàn tất!" : "Đã xong (có lỗi)"}
              </p>
              <p className="text-sm text-muted-foreground">
                Đã xử lý {processedCount} chương (Từ điển + AI sửa lỗi).
                {results.length > 0 && ` Thành công: ${results.length}.`}
                {errors.length > 0 && ` Lỗi: ${errors.length}.`}
              </p>
              {results.reduce((acc, r) => acc + (r.extractedNamesCount || 0), 0) > 0 && (
                <div className="rounded-md bg-emerald-500/10 p-2 mt-2 space-y-1">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center justify-center gap-1.5">
                    <TrendingUpIcon className="size-3.5" />
                    Đã thu thập {results.reduce((acc, r) => acc + (r.extractedNamesCount || 0), 0)} tên/thuật ngữ vào từ điển truyện
                  </p>
                  {extractDict && (
                    <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                      ✓ Đã lưu vào từ điển <strong>{GENRE_LABELS[qtDictSources[0]] || qtDictSources[0]}</strong> ({qtDictSources[0]}_names) và gửi lên hệ thống
                    </p>
                  )}
                </div>
              )}
            </div>
            {errors.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-md bg-destructive/10 p-2 text-left text-[10px] text-destructive">
                {errors.map((err, i) => (
                  <div key={i}>Chương &quot;{err.chapterTitle}&quot;: {err.message}</div>
                ))}
              </div>
            )}
            <Button onClick={handleClose} className="w-full">
              Đóng
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
