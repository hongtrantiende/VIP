"use client";

import { Button } from "@/components/ui/button";
import { ConfirmInterruptDialog } from "@/components/ui/confirm-interrupt-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { BulkTranslateOptions } from "@/lib/chapter-tools/bulk-translate";
import {
  runBulkTranslate,
  saveBulkResults,
} from "@/lib/chapter-tools/bulk-translate";
import type { ContextDepth } from "@/lib/chapter-tools/context";
import { DEFAULT_TRANSLATE_SYSTEM } from "@/lib/chapter-tools/prompts";
import {
  getChapterToolModelMissingMessage,
  resolveChapterToolModel,
} from "@/lib/chapter-tools/stream-runner";
import type { AnalysisSettings, Chapter, StepModelConfig } from "@/lib/db";
import {
  updateAnalysisSettings,
  useAIModels,
  useAIProvider,
  useAnalysisSettings,
  useApiInferenceProviders,
  useChatSettings,
  useClearWebGpuStepModel,
  useConfirmInterrupt,
} from "@/lib/hooks";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  LanguagesIcon,
  LoaderIcon,
  Minimize2Icon,
  RotateCcwIcon,
  SaveIcon,
  ScanSearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedCallback } from "@/lib/hooks/use-debounce";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { scanNovelStyle } from "@/lib/chapter-tools/scan-novel-style";



const STATUS_ICON: Record<string, React.ElementType> = {
  pending: CircleDashedIcon,
  translating: LoaderIcon,
  done: CheckCircle2Icon,
  error: AlertTriangleIcon,
};

const STATUS_CLASS: Record<string, string> = {
  pending: "text-muted-foreground",
  translating: "text-primary animate-spin",
  done: "text-emerald-500",
  error: "text-destructive",
};

function makeCallbacks(
  novelId: string,
  autoSave: boolean,
): Pick<
  BulkTranslateOptions,
  "onChapterStart" | "onChapterComplete" | "onChapterError" | "onAllComplete"
> {
  const store = useBulkTranslateStore.getState;
  return {
    onChapterStart: (chapterId) => {
      store().setCurrentChapter(novelId, chapterId);
      store().setChapterStatus(novelId, chapterId, "translating");
    },
    onChapterComplete: (result) => {
      store().setChapterStatus(novelId, result.chapterId, "done");
      store().addResult(novelId, result);
      store().incrementCompleted(novelId);
      if (autoSave) store().markSaved(novelId, [result.chapterId]);
    },
    onChapterError: (error) => {
      store().setChapterStatus(novelId, error.chapterId, "error");
      store().addError(novelId, error);
      store().incrementCompleted(novelId);
    },
    onAllComplete: () => {
      store().finish(novelId);
    },
  };
}

export function BulkTranslateDialog({
  open,
  onOpenChange,
  novelId,
  selectedChapterIds,
  chapters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novelId: string;
  selectedChapterIds: string[];
  chapters: Chapter[];
}) {
  // Store — use selectors to avoid unnecessary re-renders
  const job = useBulkTranslateStore((s) => s.jobs[novelId]);
  
  const step = job?.step ?? "config";
  const isRunning = job?.isRunning ?? false;
  const statuses = job?.statuses ?? new Map();
  const chaptersCompleted = job?.chaptersCompleted ?? 0;
  const totalChapters = job?.totalChapters ?? 0;
  const results = job?.results ?? new Map();
  const errors = job?.errors ?? [];
  const savedChapterIds = job?.savedChapterIds ?? new Set();

  useEffect(() => {
    useBulkTranslateStore.getState().initJob(novelId);
  }, [novelId]);

  const { showConfirm, guard, confirm, dismiss } =
    useConfirmInterrupt(isRunning);

  const settings = useAnalysisSettings();
  const chatSettings = useChatSettings();
  const providers = useApiInferenceProviders();
  const defaultProvider = useAIProvider(chatSettings?.providerId);

  const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);

  // Model — synced with novel settings (fallback to global)
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

  const saveModel = useCallback(async (model: StepModelConfig | undefined) => {
    try {
      await db.novels.update(novelId, {
        customTranslateProviderId: model?.providerId || "",
        customTranslateModelId: model?.modelId || "",
      });
      if (model) {
        await updateAnalysisSettings({ translateModel: model } as Partial<AnalysisSettings>);
      }
    } catch {
      /* silent */
    }
  }, [novelId]);

  const clearWebGpu = useCallback(async () => {
    await saveModel(undefined);
  }, [saveModel]);
  useClearWebGpuStepModel(currentModel?.providerId, clearWebGpu);

  const handleProviderChange = (providerId: string) => {
    saveModel(providerId ? { providerId, modelId: "" } : undefined);
  };
  const handleModelChange = (modelId: string) => {
    if (!selectedProviderId) return;
    saveModel({ providerId: selectedProviderId, modelId });
  };

  const storedPrompt = (settings.translatePrompt as string | undefined) ?? "";
  const effectivePrompt = storedPrompt || DEFAULT_TRANSLATE_SYSTEM;
  const [promptText, setPromptText] = useState(effectivePrompt);
  const [promptOpen, setPromptOpen] = useState(false);

  // ── Per-novel custom prompt ──
  const novelPrompt = novel?.customTranslatePrompt;
  const hasNovelPrompt = Boolean(novelPrompt?.trim());
  const [useNovelPrompt, setUseNovelPrompt] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");

  // When novel prompt is loaded, auto-activate it
  useEffect(() => {
    if (hasNovelPrompt && useNovelPrompt) {
      setPromptText(novelPrompt!);
    } else if (!useNovelPrompt) {
      setPromptText(effectivePrompt);
    }
  }, [hasNovelPrompt, useNovelPrompt, novelPrompt, effectivePrompt]);

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

  // Scan novel style handler
  const handleScanStyle = useCallback(async () => {
    const model = await resolveModel();
    if (!model) return;

    setScanning(true);
    setScanProgress("Bắt đầu quét...");
    try {
      const prompt = await scanNovelStyle(
        novelId,
        model,
        undefined,
        (msg) => setScanProgress(msg),
      );
      setPromptText(prompt);
      setUseNovelPrompt(true);
      toast.success("Đã quét xong và tạo prompt riêng cho truyện!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Quét thất bại");
    } finally {
      setScanning(false);
      setScanProgress("");
    }
  }, [novelId, resolveModel]);

  const savePrompt = useCallback(async (text: string) => {
    const trimmed = text.trim();
    const value =
      !trimmed || trimmed === DEFAULT_TRANSLATE_SYSTEM.trim()
        ? undefined
        : trimmed;
    try {
      await updateAnalysisSettings({
        translatePrompt: value,
      } as Partial<AnalysisSettings>);
    } catch {
      /* silent */
    }
  }, []);

  const debouncedSavePrompt = useDebouncedCallback(savePrompt, 600);

  const handlePromptChange = (text: string) => {
    setPromptText(text);
    debouncedSavePrompt.run(text);
  };

  const isCustomPrompt = promptText.trim() !== DEFAULT_TRANSLATE_SYSTEM.trim();

  // Other config
  const [translateTitle, setTranslateTitle] = useState(true);
  const [autoSave, setAutoSave] = useState(true); // <== Changed default to true
  const [skipTranslated, setSkipTranslated] = useState(true); // <== Added skipTranslated
  const [delaySeconds, setDelaySeconds] = useState(settings.translateDelaySeconds ?? 0);
  const [concurrency, setConcurrency] = useState(settings.translateConcurrency ?? 1);

  useEffect(() => {
    setDelaySeconds(settings.translateDelaySeconds ?? 0);
    setConcurrency(settings.translateConcurrency ?? 1);
  }, [settings.translateDelaySeconds, settings.translateConcurrency]);

  const handleDelayChange = (val: string) => {
    const num = parseInt(val) || 0;
    setDelaySeconds(num);
    updateAnalysisSettings({ translateDelaySeconds: num } as Partial<AnalysisSettings>);
  };

  const handleConcurrencyChange = (val: string) => {
    const num = parseInt(val) || 1;
    const clamped = Math.max(1, Math.min(20, num));
    setConcurrency(clamped);
    updateAnalysisSettings({ translateConcurrency: clamped } as Partial<AnalysisSettings>);
  };

  const selectedChapters = useMemo(
    () => chapters.filter((c) => selectedChapterIds.includes(c.id)),
    [chapters, selectedChapterIds],
  );


  const runTranslate = useCallback(
    async (chapterIds: string[]) => {
      const model = await resolveModel();
      if (!model) return;

      const signal = useBulkTranslateStore.getState().jobs[novelId]?.abortController?.signal;

      await runBulkTranslate({
        novelId,
        chapterIds,
        model,
        depth: "standard",
        translateTitle,
        autoSave,
        settings,
        skipTranslated,
        customPrompt: promptText,
        signal,
        delayMs: delaySeconds * 1000,
        ...makeCallbacks(novelId, autoSave),
      });
    },
    [
      novelId,
      translateTitle,
      autoSave,
      settings,
      promptText,
      delaySeconds,
      resolveModel,
    ],
  );

  const handleStart = useCallback(async () => {
    const activeModel = currentModel;
    if (activeModel?.providerId && activeModel?.modelId) {
       const jobs = useBulkTranslateStore.getState().jobs;
       for (const [id, job] of Object.entries(jobs)) {
          if (id !== novelId && job.isRunning && job.providerId === activeModel.providerId && job.modelId === activeModel.modelId) {
             toast.error(`Khóa AI: Mô hình AI này đang bận dịch truyện khác. Vui lòng chọn mô hình AI khác để dịch song song!`);
             return;
          }
       }
    }

    useBulkTranslateStore.getState().start(novelId, selectedChapterIds, activeModel?.providerId, activeModel?.modelId);
    await runTranslate(selectedChapterIds);
  }, [novelId, selectedChapterIds, runTranslate, currentModel]);

  const handleRetry = useCallback(async () => {
    const failedIds = errors.map((e) => e.chapterId);
    if (failedIds.length === 0) return;
    useBulkTranslateStore.getState().startRetry(novelId, failedIds);
    await runTranslate(failedIds);
  }, [novelId, errors, runTranslate]);

  const handleSaveAll = useCallback(async () => {
    const unsaved = Array.from(results.entries()).filter(
      ([id]) => !savedChapterIds.has(id),
    );
    if (unsaved.length === 0) return;

    try {
      await saveBulkResults(unsaved.map(([, r]) => r));
      useBulkTranslateStore.getState().markSaved(novelId, unsaved.map(([id]) => id));
      toast.success(`Đã lưu ${unsaved.length} chương`);
    } catch {
      toast.error("Lưu thất bại");
    }
  }, [novelId, results, savedChapterIds]);

  const handleClose = () => {
    useBulkTranslateStore.getState().reset(novelId);
    onOpenChange(false);
  };

  const progressPercent =
    totalChapters > 0 ? (chaptersCompleted / totalChapters) * 100 : 0;

  const doneCount = useMemo(
    () => Array.from(statuses.values()).filter((s) => s === "done").length,
    [statuses],
  );

  const unsavedCount = results.size - savedChapterIds.size;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (isRunning) {
            // If running, just hide (minimize) instead of canceling
            onOpenChange(false);
          } else {
            handleClose();
          }
        } else {
          onOpenChange(v);
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <ConfirmInterruptDialog
          open={showConfirm}
          onConfirm={confirm}
          onCancel={dismiss}
        />
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle>
                Dịch hàng loạt ({selectedChapterIds.length} chương)
              </DialogTitle>
              <DialogDescription>
                Dịch tuần tự từng chương đã chọn.
              </DialogDescription>
            </div>
            {isRunning && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onOpenChange(false)}
              >
                <Minimize2Icon className="mr-1.5 size-3.5" />
                Ẩn (Chạy ngầm)
              </Button>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 p-1 pr-4">
            {/* ── Step 1: Config ── */}
            {step === "config" && (
              <>

                {/* Novel Style Scanner */}
                <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ScanSearchIcon className="size-4 text-primary" />
                      <div>
                        <p className="text-xs font-medium">Quét phong cách truyện</p>
                        <p className="text-[10px] text-muted-foreground">
                          AI quét 10 chương đầu → tạo prompt dịch riêng cho bộ truyện
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={hasNovelPrompt ? "outline" : "default"}
                      className="h-8 text-xs gap-1.5"
                      onClick={handleScanStyle}
                      disabled={scanning || isRunning || !defaultProvider}
                    >
                      {scanning ? (
                        <><LoaderIcon className="size-3 animate-spin" />{"Đang quét..."}</>
                      ) : hasNovelPrompt ? (
                        <><RotateCcwIcon className="size-3" />{"Quét lại"}</>
                      ) : (
                        <><SparklesIcon className="size-3" />{"Quét ngay"}</>
                      )}
                    </Button>
                  </div>
                  {scanning && scanProgress && (
                    <p className="text-[10px] text-primary animate-pulse">{scanProgress}</p>
                  )}
                  {hasNovelPrompt && !scanning && (
                    <div className="flex items-center gap-2 pt-1">
                      <Switch
                        id="use-novel-prompt"
                        checked={useNovelPrompt}
                        onCheckedChange={(v) => {
                          setUseNovelPrompt(v);
                          setPromptText(v ? novelPrompt! : effectivePrompt);
                        }}
                      />
                      <Label htmlFor="use-novel-prompt" className="text-[10px] cursor-pointer">
                        Dùng prompt riêng của truyện
                        {novel?.styleScannedAt && (
                          <span className="text-muted-foreground ml-1">
                            (quét lúc {new Date(novel.styleScannedAt).toLocaleDateString("vi")})
                          </span>
                        )}
                      </Label>
                    </div>
                  )}
                </div>

                {/* Model picker */}
                <div className="space-y-2">
                  <Label className="text-xs">Mô hình dịch</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <NativeSelect
                      className="w-full"
                      value={selectedProviderId}
                      onChange={(e) => handleProviderChange(e.target.value)}
                    >
                      <NativeSelectOption value="">Mặc định</NativeSelectOption>
                      {providers?.map((p) => (
                        <NativeSelectOption key={p.id} value={p.id}>
                          {p.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      className="w-full"
                      value={currentModel?.modelId ?? ""}
                      onChange={(e) => handleModelChange(e.target.value)}
                      disabled={!selectedProviderId}
                    >
                      <NativeSelectOption value="">
                        {selectedProviderId ? "Chọn mô hình" : "Mặc định"}
                      </NativeSelectOption>
                      {models?.map((m) => (
                        <NativeSelectOption key={m.id} value={m.modelId}>
                          {m.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                </div>

                {/* Toggles */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="bulk-translate-title"
                      checked={translateTitle}
                      onCheckedChange={setTranslateTitle}
                    />
                    <Label
                      htmlFor="bulk-translate-title"
                      className="cursor-pointer text-xs"
                    >
                      Dịch tiêu đề chương
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="bulk-auto-save"
                      checked={autoSave}
                      onCheckedChange={setAutoSave}
                    />
                    <Label
                      htmlFor="bulk-auto-save"
                      className="cursor-pointer text-xs"
                    >
                      Tự động lưu sau mỗi chương (Khuyên dùng)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="bulk-skip-translated"
                      checked={skipTranslated}
                      onCheckedChange={setSkipTranslated}
                    />
                    <Label
                      htmlFor="bulk-skip-translated"
                      className="cursor-pointer text-xs"
                    >
                      Bỏ qua các chương đã dịch (Tránh dịch lại)
                    </Label>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <Label htmlFor="translate-delay" className="text-xs">
                      Độ trễ giữa các chương (giây)
                    </Label>
                    <input
                      id="translate-delay"
                      type="number"
                      min="0"
                      max="60"
                      className="h-8 w-16 rounded-md border bg-background px-2 text-center text-xs focus:ring-1 focus:ring-primary"
                      value={delaySeconds}
                      onChange={(e) => handleDelayChange(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <Label htmlFor="translate-concurrency" className="text-xs">
                      Số luồng chạy song song
                    </Label>
                    <input
                      id="translate-concurrency"
                      type="number"
                      min="1"
                      max="20"
                      className="h-8 w-16 rounded-md border bg-background px-2 text-center text-xs focus:ring-1 focus:ring-primary"
                      value={concurrency}
                      onChange={(e) => handleConcurrencyChange(e.target.value)}
                    />
                  </div>
                </div>

                {/* Prompt editor (collapsible) */}
                <div className="rounded-lg border">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                    onClick={() => setPromptOpen(!promptOpen)}
                  >
                    {promptOpen ? (
                      <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="text-xs font-medium">
                      Prompt dịch thuật
                    </span>
                    {!promptOpen && isCustomPrompt && (
                      <span className="text-xs text-muted-foreground">
                        (đã tùy chỉnh)
                      </span>
                    )}
                  </button>
                  {promptOpen && (
                    <div className="space-y-1.5 border-t px-3 pb-3 pt-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Prompt hệ thống</Label>
                        {isCustomPrompt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              debouncedSavePrompt.cancel();
                              handlePromptChange(DEFAULT_TRANSLATE_SYSTEM);
                            }}
                            className="h-6 text-xs"
                          >
                            <RotateCcwIcon className="mr-1 size-3" />
                            Đặt lại
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={promptText}
                        onChange={(e) => handlePromptChange(e.target.value)}
                        className="min-h-[100px] font-mono text-xs leading-relaxed"
                      />
                    </div>
                  )}
                </div>

                {!defaultProvider && (
                  <p className="text-xs text-amber-500">
                    Chưa cấu hình nhà cung cấp AI.{" "}
                    <a href="/settings/providers" className="underline">
                      Thêm ngay
                    </a>
                  </p>
                )}
              </>
            )}

            {/* ── Step 2: Progress ── */}
            {step === "progress" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Chương {chaptersCompleted} / {totalChapters}
                    </span>
                    {isRunning && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() =>
                          useBulkTranslateStore.getState().cancel(novelId)
                        }
                      >
                        <XIcon className="mr-1 size-3" />
                        Hủy
                      </Button>
                    )}
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                </div>

                <div className="space-y-1">
                  {selectedChapters.map((ch) => {
                    const status = statuses.get(ch.id) ?? "pending";
                    const Icon = STATUS_ICON[status];
                    return (
                      <div
                        key={ch.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                      >
                        <Icon
                          className={`size-3.5 shrink-0 ${STATUS_CLASS[status]}`}
                        />
                        <span className="flex-1 truncate">
                          {ch.order + 1}. {ch.title}
                        </span>
                        {status === "error" && (
                          <span className="text-destructive">Lỗi</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Step 3: Results ── */}
            {step === "results" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-4 shrink-0" />
                  <span className="text-xs font-medium">
                    Đã dịch {doneCount}/{totalChapters} chương
                    {errors.length > 0 && `, ${errors.length} lỗi`}
                  </span>
                </div>

                <div className="space-y-1">
                  {selectedChapters.map((ch) => {
                    const result = results.get(ch.id);
                    const error = errors.find((e) => e.chapterId === ch.id);
                    const saved = savedChapterIds.has(ch.id);

                    return (
                      <div
                        key={ch.id}
                        className="rounded-md border bg-muted/20 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          {result ? (
                            <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" />
                          ) : (
                            <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" />
                          )}
                          <span className="flex-1 truncate font-medium">
                            {ch.order}. {ch.title}
                          </span>
                          {saved && (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Đã lưu
                            </span>
                          )}
                        </div>
                        {result && (
                          <div className="mt-1 pl-5.5 text-muted-foreground">
                            {result.newTitle && (
                              <div>
                                <span className="line-through opacity-60">
                                  {result.originalTitle}
                                </span>
                                {" → "}
                                <span>{result.newTitle}</span>
                              </div>
                            )}
                            <div>
                              {result.originalLineCount} dòng →{" "}
                              {result.translatedLineCount} dòng
                              {result.translatedLineCount !==
                                result.originalLineCount && (
                                <span
                                  className={
                                    result.translatedLineCount >
                                    result.originalLineCount
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-amber-600 dark:text-amber-400"
                                  }
                                >
                                  {" "}
                                  (
                                  {result.translatedLineCount >
                                  result.originalLineCount
                                    ? "+"
                                    : ""}
                                  {result.translatedLineCount -
                                    result.originalLineCount}
                                  )
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {error && (
                          <p className="mt-1 pl-5.5 text-destructive">
                            {error.message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* ── Footer buttons ── */}
        {step === "config" && (
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose}>
              Hủy
            </Button>
            <Button onClick={handleStart} disabled={!defaultProvider}>
              <LanguagesIcon className="mr-1.5 size-3.5" />
              Bắt đầu dịch
            </Button>
          </div>
        )}

        {step === "results" && (
          <div className="flex justify-end gap-2 pt-2">
            {errors.length > 0 && (
              <Button variant="outline" onClick={handleRetry}>
                Thử lại ({errors.length})
              </Button>
            )}
            {!autoSave && unsavedCount > 0 && (
              <Button variant="outline" onClick={handleSaveAll}>
                <SaveIcon className="mr-1.5 size-3.5" />
                Lưu tất cả ({unsavedCount})
              </Button>
            )}
            <Button onClick={handleClose}>Đóng</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
