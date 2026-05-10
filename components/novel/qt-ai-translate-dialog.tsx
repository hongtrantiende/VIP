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
import {
  runQtAiTranslate,
  type HybridTranslateResult,
  type HybridTranslateError,
} from "@/lib/chapter-tools/qt-ai-translate";
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
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { Label } from "@/components/ui/label";
import { useDictMeta } from "@/lib/hooks/use-dict-entries";
import { cn } from "@/lib/utils";

type Phase = "idle" | "dict" | "ai" | "done";

export function QtAiTranslateDialog({
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
  const [qtDictSources, setQtDictSources] = useState<string[]>(["tienhiep"]);
  const abortRef = useRef<AbortController | null>(null);

  const GENRE_DICTS = [
    "ngontinh", "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong", 
    "nsfw", "hentai", "dongphuong", "dothi", "vongdu", "khoahuyen", 
    "quybi", "xuyenkhong", "hethong", "trinhtham", "lichsu"
  ];
  
  const GENRE_LABELS: Record<string, string> = {
    ngontinh: "Ngôn tình", hiendai: "Hiện đại", tienhiep: "Tiên hiệp",
    huyenhuyen: "Huyền huyễn", dammi: "Đam mỹ", hocduong: "Học đường",
    nsfw: "NSFW (18+)", hentai: "Hentai", dongphuong: "Đông phương",
    dothi: "Đô thị", vongdu: "Võng du", khoahuyen: "Khoa huyễn",
    quybi: "Quỷ bí", xuyenkhong: "Xuyên không", hethong: "Hệ thống",
    trinhtham: "Trinh thám", lichsu: "Lịch sử"
  };

  const dictMeta = useDictMeta();
  const dynamicSources = dictMeta 
    ? Object.keys(dictMeta.sources).filter(s => 
        !["vietphrase", "names", "names2", "phienam", "luatnhan"].includes(s) &&
        !GENRE_DICTS.includes(s)
      ) 
    : [];
  const allGenreSources = [...GENRE_DICTS, ...dynamicSources];

  const settings = useAnalysisSettings();
  const chatSettings = useChatSettings();
  const providers = useApiInferenceProviders();
  const defaultProvider = useAIProvider(chatSettings?.providerId);

  // Per-novel model settings
  const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);
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
    const activeModel = novel?.customTranslateProviderId
      ? { providerId: novel.customTranslateProviderId, modelId: novel.customTranslateModelId || "" }
      : settings.translateModel;
    const model = await resolveChapterToolModel(
      activeModel,
      defaultProvider,
      chatSettings,
    );
    if (!model) {
      toast.error(getChapterToolModelMissingMessage(defaultProvider));
    }
    return model;
  }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel, defaultProvider, chatSettings]);

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

  const handleStart = useCallback(async () => {
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
      await runQtAiTranslate({
        novelId,
        chapterIds,
        model,
        qtDictSources,
        signal: controller.signal,
        delayMs: (settings.translateDelaySeconds ?? 0) * 1000,

        onPhase: (_chapterId, phase) => {
          setCurrentPhase(phase as Phase);
        },
        onChapterStart: (_chapterId, title) => {
          setCurrentChapterTitle(title);
        },
        onChapterComplete: (result) => {
          setResults((prev) => [...prev, result]);
          setProcessedCount((c) => c + 1);
        },
        onChapterError: (error) => {
          setErrors((prev) => [...prev, error]);
          setProcessedCount((c) => c + 1);
        },
        onAllComplete: () => {
          if (!controller.signal.aborted) {
            setStep("done");
          }
        },
      });
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
            Từ điển + AI 
          </DialogTitle>
          <DialogDescription>
            Dịch bằng từ điển cục bộ (QT) + AI sửa lỗi thông minh. Rất nhanh, mượt và tiết kiệm Token.
          </DialogDescription>
        </DialogHeader>

        {step === "config" && (
          <div className="space-y-4 py-2">
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
              <p className="text-xs font-medium text-primary">Quy trình 2 giai đoạn</p>
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

            {/* ═══════════════════════════════════════════ */}
            {/* Genre Scan Section */}
            {/* ═══════════════════════════════════════════ */}
            <div className="rounded-lg border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScanSearchIcon className="size-4 text-amber-500" />
                  <span className="text-xs font-medium">Quét phong cách & thể loại</span>
                </div>
                {hasScanned && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                    ✓ Đã quét
                  </span>
                )}
              </div>

              {/* Genre badge */}
              {novel?.genre && (
                <div className="flex items-center gap-1.5">
                  <TagIcon className="size-3 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">Thể loại:</span>
                  <span className="text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">
                    {novel.genre}
                  </span>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                AI quét 2 chương đầu → phát hiện thể loại, trích xuất tên nhân vật/địa danh/vũ khí → 
                tự động lưu vào từ điển + tạo prompt dịch riêng cho truyện này.
              </p>

              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={handleScan}
                disabled={isScanning || !selectedProviderId || !currentModel?.modelId}
              >
                {isScanning ? (
                  <>
                    <Loader2Icon className="size-3.5 animate-spin" />
                    {scanProgress || "Đang quét..."}
                  </>
                ) : (
                  <>
                    <ScanSearchIcon className="size-3.5" />
                    {hasScanned ? "Quét lại phong cách" : "Quét phong cách truyện"}
                  </>
                )}
              </Button>
            </div>

            {/* ═══════════════════════════════════════════ */}
            {/* Custom Prompt Section */}
            {/* ═══════════════════════════════════════════ */}
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

            {/* Model selection */}
            <div className="space-y-2">
              <Label className="text-xs">AI Model (cho quét & sửa lỗi)</Label>
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
              <p className="text-[10px] text-muted-foreground">
                Khuyến nghị: Model nhanh + rẻ (Gemini Flash, GPT-4o-mini, Claude Haiku).
              </p>
            </div>

            <div className="rounded-md bg-muted/50 p-2.5">
              <p className="text-sm">
                Sẽ dịch <strong>{chapterIds.length}</strong> chương đã chọn.
                {hasCustomPrompt && (
                  <span className="text-emerald-600 dark:text-emerald-400"> ✓ Có prompt thể loại</span>
                )}
              </p>
            </div>

            <Button
              onClick={handleStart}
              className="w-full gap-2"
              disabled={!selectedProviderId || !currentModel?.modelId}
            >
              <ZapIcon className="size-4" />
              Bắt đầu Từ điển + AI
            </Button>
          </div>
        )}

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
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                  ✓ Tự động thu thập {results.reduce((acc, r) => acc + (r.extractedNamesCount || 0), 0)} tên/thuật ngữ vào từ điển.
                </p>
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
