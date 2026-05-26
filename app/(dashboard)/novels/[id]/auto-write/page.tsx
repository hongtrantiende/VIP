"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WritingAgentRole } from "@/lib/db";
import { db } from "@/lib/db";
import {
  createChapterPlan,
  createWritingSession,
  getOrCreateWritingSettings,
  resetWritingSessionProgress,
  updateChapterPlan,
  updateWritingSession,
  useActiveSession,
  useChapterPlans,
  useCharacters,
  useNovel,
  usePlotArcs,
  useSessionByPlan,
  useStepResults,
  useWritingSettings,
} from "@/lib/hooks";
import { useWritingPipelineStore } from "@/lib/stores/writing-pipeline";
import {
  repairSessionIfWriterOutputEmpty,
  runWritingPipeline,
} from "@/lib/writing";
import type {
  ContextAgentOutput,
  DirectionAgentOutput,
  OutlineAgentOutput,
} from "@/lib/writing/types";
import {
  ArrowLeftIcon,
  CompassIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SettingsIcon,
  PlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ContextStepPanel } from "@/components/writing/context-step-panel";
import { ChapterPreview } from "@/components/writing/chapter-preview";
import { DirectionPreFilter } from "@/components/writing/direction-pre-filter";
import { DirectionSelector } from "@/components/writing/direction-selector";
import { IdeaForm, type IdeaFormData } from "@/components/writing/idea-form";
import { NovelSetup } from "@/components/writing/novel-setup";
import { OutlineEditor } from "@/components/writing/outline-editor";
import { PipelineStepConfig } from "@/components/writing/pipeline-step-config";
import { PipelineProgress } from "@/components/writing/pipeline-progress";
import { ReviewPanel } from "@/components/writing/review-panel";
import { SetupWizard } from "@/components/writing/setup-wizard";
import { EditChapterPlanDialog } from "@/components/writing/edit-chapter-plan-dialog";
import { GenerateMorePlansDialog } from "@/components/writing/generate-more-plans-dialog";
import { WritingSettingsDialog } from "@/components/writing/writing-settings-dialog";
import { EditableText } from "@/components/novel/editable-text";

// ─── State Detection ────────────────────────────────────────

type PageMode = "empty" | "wizard" | "dashboard" | "pipeline";

const StatusLabelMap: Record<
  "planned" | "writing" | "written" | "reviewed" | "saved",
  { text: string; color: string }
> = {
  planned: { text: "Dự định", color: "bg-secondary text-muted-foreground" },
  writing: { text: "Đang viết", color: "bg-blue-500/10 text-blue-600" },
  written: { text: "Viết xong", color: "bg-amber-500/10 text-amber-600" },
  reviewed: { text: "Đã review", color: "bg-orange-500/10 text-orange-600" },
  saved: { text: "Đã lưu", color: "bg-green-500/10 text-green-600" },
};

export default function AutoWritePage() {
  const { id: novelId } = useParams<{ id: string }>();
  const novel = useNovel(novelId);
  const chapterPlans = useChapterPlans(novelId);
  const characters = useCharacters(novelId);
  const plotArcs = usePlotArcs(novelId);
  const latestSession = useActiveSession(novelId);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  // Auto-select plan on first load: use latest session's plan, or first unwritten plan
  const autoSelectedPlanId = useMemo(() => {
    if (selectedPlanId) return selectedPlanId;
    if (latestSession?.chapterPlanId) return latestSession.chapterPlanId;
    const nextUnwritten = chapterPlans?.find((p) => p.status === "planned");
    return nextUnwritten?.id ?? chapterPlans?.[0]?.id ?? null;
  }, [selectedPlanId, latestSession?.chapterPlanId, chapterPlans]);

  const effectivePlanId = autoSelectedPlanId;
  const planSession = useSessionByPlan(effectivePlanId ?? undefined);
  const activeSession = effectivePlanId ? planSession : latestSession;
  const stepResults = useStepResults(activeSession?.id);
  const writingSettings = useWritingSettings(novelId);

  const currentPlan = useMemo(
    () => chapterPlans?.find((p) => p.id === effectivePlanId) ?? null,
    [chapterPlans, effectivePlanId],
  );
  const isSaved = currentPlan?.status === "saved";

  const writingTabsScrollClass =
    "h-[calc(100dvh-144px)] min-h-[240px] w-full";

  const {
    isRunning,
    activePanel,
    setActivePanel,
    startPipeline,
    pausePipeline,
    cancelPipeline,
    appendStreamingContent,
    clearStreamingContent,
    clearWriterActivityLabel,
    pipelinePreRunRole,
    setPipelinePreRunRole,
    requestReviewCompareFocus,
  } = useWritingPipelineStore();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedSettingsRole, setSelectedSettingsRole] = useState<WritingAgentRole | undefined>(undefined);
  const [refreshSessionOpen, setRefreshSessionOpen] = useState(false);
  const [staleWarning, setStaleWarning] = useState(false);
  const [ideaData, setIdeaData] = useState<IdeaFormData | null>(null);
  const [modeOverride, setModeOverride] = useState<PageMode | null>(null);
  const [isGeneratingPlans, setIsGeneratingPlans] = useState(false);
  const [generateMorePlansOpen, setGenerateMorePlansOpen] = useState(false);
  const [editPlanId, setEditPlanId] = useState<string | null>(null);
  const [wizardStartStep, setWizardStartStep] = useState<"world" | "characters" | "arcs" | "plans" | null>(null);

  const [selectedPartFilter, setSelectedPartFilter] = useState<number | "all">("all");
  const [isAutoWriting, setIsAutoWriting] = useState(false);
  const runAutoWriteLoopRef = useRef<boolean>(false);

  const [isEvaluatingOverall, setIsEvaluatingOverall] = useState(false);
  const [overallEvalResult, setOverallEvalResult] = useState<string | null>(null);
  const [overallEvalChapters, setOverallEvalChapters] = useState<string[]>([]);
  const [showOverallEvalDialog, setShowOverallEvalDialog] = useState(false);
  const [overallEvalFeedback, setOverallEvalFeedback] = useState("");
  const [isApplyingOverallFixes, setIsApplyingOverallFixes] = useState(false);
  const [overallFixesProgress, setOverallFixesProgress] = useState("");

  const targetChapterCount = (writingSettings as any)?.targetChapterCount ?? chapterPlans?.length ?? 50;
  const targetParts = (writingSettings as any)?.targetParts ?? 3;
  const chaptersPerPart = Math.ceil(targetChapterCount / targetParts);

  const getPartRange = useCallback((part: number) => {
    const start = (part - 1) * chaptersPerPart + 1;
    const end = Math.min(part * chaptersPerPart, targetChapterCount);
    return { start, end, count: end - start + 1 };
  }, [chaptersPerPart, targetChapterCount]);

  const getPartLabel = useCallback((part: number) => {
    const { start, end } = getPartRange(part);
    if (part === 1) return `Phần ${part}: Mở đầu (Ch.${start}-${end})`;
    if (part === targetParts) return `Phần ${part}: Kết thúc (Ch.${start}-${end})`;
    return `Phần ${part}: Phát triển (Ch.${start}-${end})`;
  }, [getPartRange, targetParts]);

  const startAutoWriting = useCallback(async (part: number | "all") => {
    if (!chapterPlans) return;
    setIsAutoWriting(true);
    runAutoWriteLoopRef.current = true;
    
    toast.info(`Bắt đầu tự động viết ${part === "all" ? "toàn bộ các phần" : `Phần ${part}`}. Hệ thống sẽ tự động chạy 4 bước đầu.`);

    const writtenChapterPlanIds: string[] = [];
    let currentPart = part;
    while (runAutoWriteLoopRef.current) {
      // Tải lại kế hoạch chương để có trạng thái mới nhất
      const plans = await db.chapterPlans.where("novelId").equals(novelId).sortBy("chapterOrder");
      
      // Tìm chương chưa viết đầu tiên trong phạm vi phần được chọn
      let targetPlans = plans;
      if (currentPart !== "all") {
        const { start, end } = getPartRange(Number(currentPart));
        targetPlans = plans.filter(p => p.chapterOrder >= start && p.chapterOrder <= end);
      }
      
      const nextPlanToRun = targetPlans.find(p => p.status !== "saved");
      if (!nextPlanToRun) {
        if (currentPart === "all" && plans.length < targetChapterCount) {
          const nextCount = Math.min(2 * chaptersPerPart, targetChapterCount - plans.length);
          if (nextCount > 0) {
            toast.info(`Đã viết hết các chương hiện có. Đang tự động lên kế hoạch cho 2 Phần tiếp theo (${nextCount} chương)...`);
            setIsGeneratingPlans(true);
            try {
              const { generateFromExisting } = await import("@/lib/writing/auto-generate");
              await generateFromExisting(novelId, {
                planCount: nextCount,
              });
              toast.success("Đã tự động lên kế hoạch thành công! Tiếp tục viết...");
              setIsGeneratingPlans(false);
              continue;
            } catch (err) {
              toast.error("Lỗi khi tự động lên kế hoạch tiếp theo: " + (err instanceof Error ? err.message : String(err)));
              setIsGeneratingPlans(false);
              break;
            }
          }
        }
        toast.success(`Đã hoàn thành viết tự động toàn bộ ${currentPart === "all" ? "các chương" : `Phần ${currentPart}`}!`);
        break;
      }

      setSelectedPlanId(nextPlanToRun.id);
      
      // Chờ giao diện cập nhật và focus vào chương mới
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!runAutoWriteLoopRef.current) break;

      try {
        let session = await db.writingSessions
          .where("chapterPlanId")
          .equals(nextPlanToRun.id)
          .first();
        
        let sessionId = session?.id;
        if (!sessionId) {
          await getOrCreateWritingSettings(novelId);
          sessionId = await createWritingSession({
            novelId,
            chapterPlanId: nextPlanToRun.id,
            currentStep: "context",
            status: "active",
          });
        } else {
          await db.writingSessions.update(sessionId, { status: "active" });
        }

        if (nextPlanToRun.status !== "written" && nextPlanToRun.status !== "saved") {
          const controller = startPipeline(sessionId!);
          clearStreamingContent();
          
          const ins = useWritingPipelineStore.getState().stepUserInstructions;
          const stepUserInstructions: Partial<Record<WritingAgentRole, string>> = {};
          for (const role of ["context", "direction", "outline", "writer"] as const) {
            const v = ins[role]?.trim();
            if (v) stepUserInstructions[role] = v;
          }
          const { directionArcIds, directionCharacterIds } = useWritingPipelineStore.getState();

          const pipelineResult = await runWritingPipeline({
            novelId,
            sessionId: sessionId!,
            abortSignal: controller.signal,
            stepUserInstructions,
            directionArcIds,
            directionCharacterIds,
            handsFree: true, // Ép buộc chạy hands-free tự động hoàn toàn
            maxStep: "writer", // Bốn bước thôi
            onStepStart: (role) => {
              if (role === "context") setActivePanel("context");
              if (role === "writer") setActivePanel("content");
            },
            onStepComplete: (role) => {
              if (role === "context") setActivePanel("context");
              if (role === "direction") setActivePanel("pipeline");
              if (role === "outline") setActivePanel("outline");
              if (role === "writer") setActivePanel("review");
            },
            onWriterChunk: (chunk) => appendStreamingContent(chunk),
            onWriterActivity: (label) => useWritingPipelineStore.getState().setWriterActivityLabel(label),
          });

          useWritingPipelineStore.getState().abortController = null;
          useWritingPipelineStore.getState().clearWriterActivityLabel();
          useWritingPipelineStore.setState({ isRunning: false });

          if (pipelineResult !== "completed") {
            toast.error(`Dừng tự động viết tại chương ${nextPlanToRun.chapterOrder} do pipeline không hoàn thành (${pipelineResult})`);
            break;
          }
        }

        // 2. Lưu chương
        if (runAutoWriteLoopRef.current) {
          const outlineJson = await db.writingStepResults
            .where("[sessionId+role]")
            .equals([sessionId!, "outline"])
            .first();
          
          if (!outlineJson?.output) {
            toast.error(`Không tìm thấy giàn ý để lưu chương ${nextPlanToRun.chapterOrder}`);
            break;
          }

          const { saveGeneratedChapter } = await import("@/lib/writing/save-chapter");
          const outline = JSON.parse(outlineJson.output);
          await saveGeneratedChapter({
            novelId,
            sessionId: sessionId!,
            chapterPlanId: nextPlanToRun.id,
            outline,
          });
          
          writtenChapterPlanIds.push(nextPlanToRun.id);
          toast.success(`Đã tự động lưu chương ${nextPlanToRun.chapterOrder}`);
        }
      } catch (err) {
        toast.error(`Lỗi tại chương ${nextPlanToRun.chapterOrder}: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      
      // Khoảng nghỉ nhỏ giữa các chương
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Tự động chạy đánh giá tổng quát sau khi hoàn thành
    if (writtenChapterPlanIds.length > 0 && runAutoWriteLoopRef.current) {
      setIsEvaluatingOverall(true);
      toast.info("Đang tự động thực hiện đánh giá tổng quát các chương mới viết...");
      try {
        const { generateOverallEvaluation } = await import("@/lib/writing/overall-eval");
        const evalResult = await generateOverallEvaluation(novelId, writtenChapterPlanIds);
        await db.novels.update(novelId, { overallEvaluation: evalResult });
        setOverallEvalChapters(writtenChapterPlanIds);
        setOverallEvalResult(evalResult);
        setShowOverallEvalDialog(true);
        toast.success("Đã hoàn tất báo cáo đánh giá tổng quát!");
      } catch (err) {
        toast.error("Lỗi khi tự động đánh giá tổng quát: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setIsEvaluatingOverall(false);
      }
    }

    setIsAutoWriting(false);
    runAutoWriteLoopRef.current = false;
  }, [novelId, chapterPlans, getPartRange, startPipeline, clearStreamingContent, setActivePanel, appendStreamingContent]);

  const stopAutoWriting = useCallback(() => {
    runAutoWriteLoopRef.current = false;
    setIsAutoWriting(false);
    pausePipeline();
    toast.info("Đã gửi yêu cầu dừng tự động viết.");
  }, [pausePipeline]);

  // ── 3-State Routing ───────────────────────────────────────

  const hasWorld = !!(novel?.worldOverview || novel?.factions?.length);
  const hasCharacters = (characters?.length ?? 0) > 0;
  const hasPlotArcs = (plotArcs?.length ?? 0) > 0;
  const hasChapterPlans = (chapterPlans?.length ?? 0) > 0;
  const hasPartialData = hasWorld || hasCharacters;

  const autoMode = useMemo((): PageMode => {
    if (hasChapterPlans && hasPlotArcs) return "pipeline";
    if (hasPartialData) return "dashboard";
    return "empty";
  }, [hasChapterPlans, hasPlotArcs, hasPartialData]);

  const mode = modeOverride ?? autoMode;

  // Reset override when data changes enough to move to pipeline, ONLY from wizard
  useEffect(() => {
    if (hasChapterPlans && hasPlotArcs && modeOverride === "wizard") {
      setModeOverride(null);
    }
  }, [hasChapterPlans, hasPlotArcs, modeOverride]);

  // ── Pipeline Data ─────────────────────────────────────────

  const nextPlan = useMemo(
    () => chapterPlans?.find((p) => p.status === "planned") ?? null,
    [chapterPlans],
  );

  const resultMap = useMemo(
    () => new Map(stepResults?.map((r) => [r.role, r]) ?? []),
    [stepResults],
  );

  const directionOutput = useMemo(() => {
    const raw = resultMap.get("direction")?.output;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DirectionAgentOutput;
    } catch {
      return null;
    }
  }, [resultMap]);

  const contextOutput = useMemo(() => {
    const raw = resultMap.get("context")?.output;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ContextAgentOutput;
    } catch {
      return null;
    }
  }, [resultMap]);

  const outlineOutput = useMemo(() => {
    const raw = resultMap.get("outline")?.output;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OutlineAgentOutput;
    } catch {
      return null;
    }
  }, [resultMap]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPipeline();
      runAutoWriteLoopRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sid = activeSession?.id;
    if (!sid) return;
    void repairSessionIfWriterOutputEmpty(sid);
  }, [activeSession?.id]);

  // ── Pipeline Control ──────────────────────────────────────

  const handleStartPipeline = useCallback(
    async (planId?: string) => {
      setPipelinePreRunRole(null);
      const targetPlanId = planId ?? effectivePlanId ?? nextPlan?.id;
      if (!targetPlanId) return;

      let sessionId = activeSession?.id;
      if (!sessionId) {
        await getOrCreateWritingSettings(novelId);
        sessionId = await createWritingSession({
          novelId,
          chapterPlanId: targetPlanId,
          currentStep: "context",
          status: "active",
        });
      }

      const controller = startPipeline(sessionId);
      clearStreamingContent();

      const ins = useWritingPipelineStore.getState().stepUserInstructions;
      const pipelineInstructionKeys: WritingAgentRole[] = [
        "context",
        "direction",
        "outline",
        "writer",
        "review",
        "rewrite",
      ];
      const stepUserInstructions: Partial<Record<WritingAgentRole, string>> =
        {};
      for (const role of pipelineInstructionKeys) {
        const v = ins[role]?.trim();
        if (v) stepUserInstructions[role] = v;
      }

      const { directionArcIds, directionCharacterIds } =
        useWritingPipelineStore.getState();

      const result = await runWritingPipeline({
        novelId,
        sessionId,
        abortSignal: controller.signal,
        stepUserInstructions,
        directionArcIds,
        directionCharacterIds,
        onStepStart: (role) => {
          if (role === "context") setActivePanel("context");
          if (role === "writer") setActivePanel("content");
        },
        onStepComplete: (role) => {
          switch (role) {
            case "context":
              setActivePanel("context");
              break;
            case "direction":
              setActivePanel("pipeline");
              break;
            case "outline":
              // outline done → show outline editor
              setActivePanel("outline");
              break;
            case "writer":
              useWritingPipelineStore.getState().clearWriterActivityLabel();
              // writer done → review is next, switch to review
              setActivePanel("review");
              break;
            case "review":
              setActivePanel("review");
              break;
          }
        },
        onWriterChunk: (chunk) => {
          appendStreamingContent(chunk);
        },
        onWriterActivity: (label) => {
          useWritingPipelineStore.getState().setWriterActivityLabel(label);
        },
      });

      // Pipeline returned — stop the running state
      useWritingPipelineStore.getState().abortController = null;
      useWritingPipelineStore.getState().clearWriterActivityLabel();
      useWritingPipelineStore.setState({ isRunning: false });

      if (result === "awaiting-input") {
        const session = await db.writingSessions.get(sessionId!);
        if (session) {
          const dirRow = await db.writingStepResults
            .where("[sessionId+role]")
            .equals([sessionId!, "direction"])
            .first();
          const directionStepDone = dirRow?.status === "completed";

          if (session.currentStep === "direction") {
            setActivePanel("pipeline");
            setPipelinePreRunRole(directionStepDone ? null : "direction");
          } else if (session.currentStep === "outline") {
            setActivePanel("outline");
            setPipelinePreRunRole(null);
          } else if (session.currentStep === "review") {
            setActivePanel("review");
            setPipelinePreRunRole(null);
          } else if (session.currentStep === "writer") {
            setActivePanel("content");
            setPipelinePreRunRole(null);
          } else if (session.currentStep === "context") {
            setActivePanel("context");
            setPipelinePreRunRole(null);
          }
        }
      } else if (result === "stale-context") {
        setStaleWarning(true);
      } else if (result === "completed") {
        setActivePanel("review");
      }
    },
    [
      novelId,
      activeSession,
      effectivePlanId,
      nextPlan,
      startPipeline,
      clearStreamingContent,
      appendStreamingContent,
      setActivePanel,
      setPipelinePreRunRole,
    ],
  );

  const handleConfirmRefreshSession = useCallback(async () => {
    if (!activeSession?.id) return;
    setRefreshSessionOpen(false);
    pausePipeline();
    try {
      await resetWritingSessionProgress(activeSession.id);
      clearStreamingContent();
      clearWriterActivityLabel();
      setActivePanel("context");
      setPipelinePreRunRole(null);
      toast.success("Đã làm mới phiên viết");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không thể làm mới phiên");
    }
  }, [
    activeSession,
    pausePipeline,
    clearStreamingContent,
    clearWriterActivityLabel,
    setActivePanel,
    setPipelinePreRunRole,
  ]);

  const handleDirectionConfirm = useCallback(
    async (directions: string[]) => {
      if (!activeSession) return;
      const plan = await db.chapterPlans.get(activeSession.chapterPlanId);
      if (!plan) return;
      await updateChapterPlan(plan.id, { directions });
      await updateWritingSession(activeSession.id, { currentStep: "outline" });
      setActivePanel("outline");
      setPipelinePreRunRole(null);
    },
    [activeSession, setActivePanel, setPipelinePreRunRole],
  );

  const handleOutlineApprove = useCallback(
    async (scenes: import("@/lib/writing/types").OutlineScene[]) => {
      if (!activeSession || !outlineOutput) return;
      const plan = await db.chapterPlans.get(activeSession.chapterPlanId);
      if (!plan) return;
      await updateChapterPlan(plan.id, {
        outline: outlineOutput.synopsis,
        scenes: scenes.map((s) => ({
          title: s.title,
          summary: s.summary,
          characters: s.characters,
          location: s.location,
          mood: s.mood,
        })),
        title: outlineOutput.chapterTitle,
      });
      await updateWritingSession(activeSession.id, { currentStep: "writer" });
      setActivePanel("content");
      setPipelinePreRunRole(null);
    },
    [activeSession, outlineOutput, setActivePanel, setPipelinePreRunRole],
  );

  const selectNextPlan = useCallback(() => {
    if (!chapterPlans || !effectivePlanId) return;
    const currentIdx = chapterPlans.findIndex((p) => p.id === effectivePlanId);
    const next = chapterPlans.find(
      (p, i) => i > currentIdx && p.status === "planned",
    );
    if (next) {
      setSelectedPlanId(next.id);
      setActivePanel("context");
    } else {
      setActivePanel("context");
    }
  }, [chapterPlans, effectivePlanId, setActivePanel]);

  const runGenerateMorePlans = useCallback(
    async (userInstruction?: string) => {
      if (!chapterPlans) return;
      const total = chapterPlans.length;
      const saved = chapterPlans.filter((p) => p.status === "saved").length;
      const completionPct = total > 0 ? (saved / total) * 100 : 0;

      if (completionPct < 70) {
        toast.warning(
          `Mới lưu ${saved}/${total} chương (${Math.round(completionPct)}%). Nên lưu ít nhất 70% trước khi tạo thêm.`,
        );
        return;
      }

      setIsGeneratingPlans(true);
      try {
        const { generateFromExisting } =
          await import("@/lib/writing/auto-generate");
        await generateFromExisting(novelId, {
          userInstruction: userInstruction?.trim() || undefined,
        });
        toast.success("Đã tạo thêm kế hoạch chương mới");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        toast.error(err instanceof Error ? err.message : "Lỗi không xác định");
      } finally {
        setIsGeneratingPlans(false);
      }
    },
    [chapterPlans, novelId],
  );

  const [isRewriting, setIsRewriting] = useState(false);

  const handleRewrite = useCallback(async () => {
    if (!activeSession) return;
    setIsRewriting(true);
    setActivePanel("content");
    clearStreamingContent();
    try {
      const { runRewriteStep } = await import("@/lib/writing/orchestrator");
      const rewriteHint = useWritingPipelineStore
        .getState()
        .stepUserInstructions.rewrite?.trim();
      const outcome = await runRewriteStep({
        novelId,
        sessionId: activeSession.id,
        onChunk: (chunk) => appendStreamingContent(chunk),
        ...(rewriteHint ? { userInstruction: rewriteHint } : {}),
      });
      if (outcome === "completed") {
        toast.success("Đã viết lại chương");
        requestReviewCompareFocus();
        setActivePanel("review");
      } else {
        toast.error("Viết lại thất bại");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error(err.message);
      }
    } finally {
      clearStreamingContent();
      setIsRewriting(false);
    }
  }, [
    activeSession,
    novelId,
    clearStreamingContent,
    appendStreamingContent,
    setActivePanel,
    requestReviewCompareFocus,
  ]);

  const handleSaveChapter = useCallback(async () => {
    if (!activeSession) return;
    const outlineJson = await db.writingStepResults
      .where("[sessionId+role]")
      .equals([activeSession.id, "outline"])
      .first();
    if (!outlineJson?.output) {
      toast.error("Không tìm thấy giàn ý. Vui lòng kiểm tra lại pipeline.");
      return;
    }
    try {
      const { saveGeneratedChapter } =
        await import("@/lib/writing/save-chapter");
      const outline = JSON.parse(outlineJson.output);
      await saveGeneratedChapter({
        novelId,
        sessionId: activeSession.id,
        chapterPlanId: activeSession.chapterPlanId,
        outline,
      });
      toast.success("Đã lưu chương");
      selectNextPlan();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi khi lưu chương");
    }
  }, [activeSession, novelId, selectNextPlan]);

  const handleStaleRerun = useCallback(async () => {
    if (!activeSession) return;
    await updateWritingSession(activeSession.id, {
      currentStep: "context",
      contextHash: undefined,
    });
    setStaleWarning(false);
    handleStartPipeline();
  }, [activeSession, handleStartPipeline]);

  // ── Step Re-run Handlers ───────────────────────────────────

  const resetStepsFromOnly = useCallback(
    async (
      fromStep: WritingAgentRole,
      opts?: { clearDirections?: boolean; clearOutline?: boolean },
    ) => {
      if (!activeSession) return;
      const stepsToDelete: WritingAgentRole[] = [
        "context",
        "direction",
        "outline",
        "writer",
        "review",
        "rewrite",
      ];
      const fromIdx = stepsToDelete.indexOf(fromStep);
      for (const role of stepsToDelete.slice(fromIdx)) {
        const result = await db.writingStepResults
          .where("[sessionId+role]")
          .equals([activeSession.id, role])
          .first();
        if (result) await db.writingStepResults.delete(result.id);
      }
      if (opts?.clearDirections || opts?.clearOutline) {
        await db.chapterPlans.update(activeSession.chapterPlanId, {
          ...(opts.clearDirections ? { directions: [] } : {}),
          ...(opts.clearOutline ? { outline: undefined, scenes: [] } : {}),
          status: "writing",
          updatedAt: new Date(),
        });
      }
      await updateWritingSession(activeSession.id, { currentStep: fromStep });
      if (fromStep === "writer") clearStreamingContent();
    },
    [activeSession, clearStreamingContent],
  );

  const handleRerunContext = useCallback(async () => {
    await resetStepsFromOnly("context", {
      clearDirections: true,
      clearOutline: true,
    });
    clearStreamingContent();
    setPipelinePreRunRole("context");
    setActivePanel("context");
  }, [
    resetStepsFromOnly,
    clearStreamingContent,
    setPipelinePreRunRole,
    setActivePanel,
  ]);

  const handleRerunDirection = useCallback(async () => {
    await resetStepsFromOnly("direction", {
      clearDirections: true,
      clearOutline: true,
    });
    setPipelinePreRunRole("direction");
    setActivePanel("pipeline");
  }, [resetStepsFromOnly, setPipelinePreRunRole, setActivePanel]);

  const handleRerunOutline = useCallback(async () => {
    await resetStepsFromOnly("outline", { clearOutline: true });
    setPipelinePreRunRole("outline");
    setActivePanel("outline");
  }, [resetStepsFromOnly, setPipelinePreRunRole, setActivePanel]);

  const handleRerunWriter = useCallback(async () => {
    await resetStepsFromOnly("writer");
    setPipelinePreRunRole("writer");
    setActivePanel("content");
  }, [resetStepsFromOnly, setPipelinePreRunRole, setActivePanel]);

  const handleRerunReview = useCallback(async () => {
    await resetStepsFromOnly("review");
    setPipelinePreRunRole("review");
    setActivePanel("review");
  }, [resetStepsFromOnly, setPipelinePreRunRole, setActivePanel]);

  // ── Dashboard Actions ─────────────────────────────────────

  const handleDashboardAction = useCallback(
    async (action: "auto-generate" | "chat" | "rewrite" | "skip", startStep?: string) => {
      switch (action) {
        case "skip":
          setModeOverride("pipeline");
          break;
        case "chat":
          // Open wizard at the specified step or first missing step
          setIdeaData({
            genre: novel?.genre ?? "",
            setting: novel?.storySetting ?? "",
            idea: novel?.synopsis ?? novel?.description ?? "",
            style: "",
          });
          if (startStep) {
            setWizardStartStep(startStep as any);
          } else {
            setWizardStartStep(null);
          }
          setModeOverride("wizard");
          break;
        case "rewrite":
          // Xóa kế hoạch chương cũ + writing sessions, giữ nguyên arcs để user xem/sửa
          await db.chapterPlans.where("novelId").equals(novelId).delete();
          await db.writingSessions.where("novelId").equals(novelId).delete();
          // Mở wizard bắt đầu từ bước "arcs" để user xem/sửa mạch truyện
          setIdeaData({
            genre: novel?.genre ?? "",
            setting: novel?.storySetting ?? "",
            idea: novel?.synopsis ?? novel?.description ?? "",
            style: "",
          });
          setWizardStartStep("world");
          setModeOverride("wizard");
          break;
        // auto-generate is handled inside NovelSetup itself
      }
    },
    [novel, novelId],
  );

  // ── Render ────────────────────────────────────────────────

  if (!novel) return <Skeleton className="h-screen w-full" />;

  const sessionNeedsResume =
    activeSession?.status === "paused" || activeSession?.status === "error";

  const writerOutputDone =
    resultMap.get("writer")?.status === "completed" &&
    !!resultMap.get("writer")?.output?.trim();
  const reviewOutputDone = resultMap.get("review")?.status === "completed";

  const outlineStepComplete = resultMap.get("outline")?.status === "completed";
  const showWriterSetupOnContentTab =
    !writerOutputDone &&
    !isRunning &&
    activeSession &&
    outlineStepComplete &&
    activeSession.currentStep !== "context" &&
    activeSession.currentStep !== "direction" &&
    activeSession.currentStep !== "outline" &&
    (activeSession.currentStep === "writer" ||
      activeSession.currentStep === "review" ||
      activeSession.status === "error");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href={`/novels/${novelId}`}>
            <ArrowLeftIcon className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {novel.title} — Auto-Write
          </h1>
        </div>
        <div className="flex items-center gap-1">
          {mode === "pipeline" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="mr-2"
                onClick={() => setModeOverride("dashboard")}
                title="Quay lại khu vực Setup ban đầu"
              >
                <CompassIcon className="h-4 w-4 mr-1" />
                Bảng Setup
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="mr-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700"
                onClick={async () => {
                  if (!confirm("Bạn có chắc muốn làm lại? Thao tác này sẽ xóa toàn bộ Mạch truyện và Kế hoạch chương (giữ nguyên Thế giới quan, Nhân vật).")) return;
                  // Xóa mạch truyện và kế hoạch chương, giữ nguyên thế giới quan + nhân vật
                  await db.plotArcs.where("novelId").equals(novelId).delete();
                  await db.chapterPlans.where("novelId").equals(novelId).delete();
                  // Xóa các writing sessions liên quan
                  await db.writingSessions.where("novelId").equals(novelId).delete();
                  toast.success("Đã xóa Mạch truyện & Kế hoạch chương. Bạn có thể setup lại.");
                  setModeOverride(null); // autoMode sẽ tự detect → dashboard
                }}
                title="Xóa Mạch truyện & Kế hoạch chương để setup lại"
              >
                <RotateCcwIcon className="h-4 w-4 mr-1" />
                Làm lại từ đầu
              </Button>
              {isRunning ? (
                <Button variant="ghost" size="sm" onClick={pausePipeline}>
                  <PauseIcon className="h-4 w-4 mr-1" />
                  Tạm dừng
                </Button>
              ) : activeSession ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleStartPipeline()}
                  disabled={isAutoWriting}
                >
                  <PlayIcon className="h-4 w-4 mr-1" />
                  Tiếp tục
                </Button>
              ) : nextPlan ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleStartPipeline(nextPlan.id)}
                  disabled={isAutoWriting}
                >
                  <PlayIcon className="h-4 w-4 mr-1" />
                  Viết chương {nextPlan.chapterOrder}
                </Button>
              ) : null}
            </>
          )}
          {mode === "dashboard" && (
            <Button
              variant="outline"
              size="sm"
              className="mr-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700"
              onClick={async () => {
                if (!confirm("Bạn có chắc muốn làm lại? Thao tác này sẽ xóa toàn bộ Mạch truyện và Kế hoạch chương (giữ nguyên Thế giới quan, Nhân vật).")) return;
                await db.plotArcs.where("novelId").equals(novelId).delete();
                await db.chapterPlans.where("novelId").equals(novelId).delete();
                await db.writingSessions.where("novelId").equals(novelId).delete();
                toast.success("Đã xóa Mạch truyện & Kế hoạch chương. Bạn có thể setup lại.");
                setModeOverride(null);
              }}
              title="Xóa Mạch truyện & Kế hoạch chương để setup lại"
            >
              <RotateCcwIcon className="h-4 w-4 mr-1" />
              Làm lại từ đầu
            </Button>
          )}
          {activeSession && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Làm mới phiên"
              onClick={() => setRefreshSessionOpen(true)}
            >
              <RotateCcwIcon className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setSelectedSettingsRole(undefined);
              setSettingsOpen(true);
            }}
            title="Cài đặt viết truyện"
          >
            <SettingsIcon className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main content by mode */}
      {mode === "empty" && (
        <div className="flex-1 overflow-auto">
          <IdeaForm
            onSubmitAction={(data) => {
              setIdeaData(data);
              setModeOverride("wizard");
            }}
          />
        </div>
      )}

      {mode === "wizard" && ideaData && (
        <div className="flex-1">
          <SetupWizard
            key={wizardStartStep ?? "default"}
            novelId={novelId}
            ideaData={ideaData}
            startAtStep={
              wizardStartStep ??
              (hasWorld
                ? hasCharacters
                  ? hasPlotArcs
                    ? "plans"
                    : "arcs"
                  : "characters"
                : "world")
            }
            onCompleteAction={() => { setModeOverride("pipeline"); setWizardStartStep(null); }}
          />
        </div>
      )}

      {mode === "dashboard" && (
        <div className="flex-1 overflow-hidden">
          <NovelSetup
            novelId={novelId}
            onActionAction={handleDashboardAction}
          />
        </div>
      )}

      {mode === "pipeline" && (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel defaultSize="320px" minSize="260px" maxSize="400px">
            <div className="flex h-full flex-col border-r">
              <div className="p-3">
                <PipelineProgress
                  sessionId={activeSession?.id}
                  currentStep={activeSession?.currentStep}
                  sessionStatus={activeSession?.status}
                  onRetryAction={() => void handleStartPipeline()}
                  onStepClick={(role) => {
                    const panelMap: Record<
                      WritingAgentRole,
                      typeof activePanel
                    > = {
                      context: "context",
                      direction: "pipeline",
                      outline: "outline",
                      writer: "content",
                      review: "review",
                      rewrite: "content",
                    };
                    setActivePanel(panelMap[role]);
                  }}
                />
              </div>
              <ScrollArea className="flex-1 border-t p-3">
                {/* Chọn phần và Tự động viết */}
                {chapterPlans && chapterPlans.length > 0 && (
                  <div className="mb-4 space-y-2 border-b pb-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Chọn Phần (Volume)
                      </label>
                      <select
                        value={selectedPartFilter}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedPartFilter(val === "all" ? "all" : Number(val));
                        }}
                        disabled={isAutoWriting}
                        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="all">Tất cả các phần</option>
                        {Array.from({ length: targetParts }, (_, i) => {
                          const p = i + 1;
                          return (
                            <option key={p} value={p}>
                              {getPartLabel(p)}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {isAutoWriting ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="w-full text-xs font-medium flex items-center justify-center gap-1.5 py-1.5"
                        onClick={stopAutoWriting}
                      >
                        <span className="relative flex h-2 w-2 mr-1">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-100"></span>
                        </span>
                        Dừng tự động viết
                      </Button>
                    ) : (
                      <div className="space-y-1.5">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="w-full text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm flex items-center justify-center gap-1.5 py-1.5 transition-all duration-200 hover:shadow-md"
                          onClick={() => startAutoWriting(selectedPartFilter)}
                        >
                          <PlayIcon className="h-3 w-3 fill-current" />
                          Tự động viết {selectedPartFilter === "all" ? "hết truyện" : `Phần ${selectedPartFilter}`}
                        </Button>
                        {novel?.overallEvaluation && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full text-xs font-semibold border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/5 flex items-center justify-center gap-1.5 py-1.5 transition-all mt-1"
                            onClick={async () => {
                              setOverallEvalResult(novel.overallEvaluation || "");
                              const savedPlans = chapterPlans?.filter(p => p.status === "saved").map(p => p.id) || [];
                              setOverallEvalChapters(savedPlans);
                              setShowOverallEvalDialog(true);
                            }}
                          >
                            📊 Xem đánh giá tổng quát ({chapterPlans?.filter(p => p.status === "saved").length} chương)
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Kế hoạch chương
                  </h3>
                  {chapterPlans && chapterPlans.length > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {chapterPlans.filter((p) => p.status === "saved").length}/
                      {chapterPlans.length}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {chapterPlans
                    ?.filter((plan) => {
                      if (selectedPartFilter === "all") return true;
                      const { start, end } = getPartRange(Number(selectedPartFilter));
                      return plan.chapterOrder >= start && plan.chapterOrder <= end;
                    })
                    ?.map((plan) => {
                      const originalIdx = chapterPlans.findIndex((p) => p.id === plan.id);
                      const prevPlan = originalIdx > 0 ? chapterPlans[originalIdx - 1] : null;
                      const prevDone = !prevPlan || prevPlan.status === "saved";
                      const isLocked = !prevDone && plan.status === "planned";
                      return (
                        <div key={plan.id} className="group/plan-item relative">
                          <button
                            onClick={() =>
                              !isLocked && setSelectedPlanId(plan.id)
                            }
                            disabled={isLocked || isAutoWriting}
                            className={`w-full text-left rounded-md px-3 py-1 pr-7 text-xs transition-colors flex ${
                              isLocked
                                ? "opacity-40 cursor-not-allowed"
                                : effectivePlanId === plan.id
                                  ? "bg-accent"
                                  : "hover:bg-accent/50"
                            }`}
                          >
                            <span className="font-medium">
                              {plan.chapterOrder}.
                            </span>
                            {plan.title && (
                              <span className="text-muted-foreground ml-1 line-clamp-1 flex-1">
                                {plan.title}
                              </span>
                            )}
                            <span
                              className={`ml-2 shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[10px] ${
                                plan.status === "saved"
                                  ? "bg-green-500/10 text-green-600"
                                  : plan.status === "reviewed"
                                    ? "bg-orange-500/10 text-orange-600"
                                    : plan.status === "written"
                                      ? "bg-amber-500/10 text-amber-600"
                                      : plan.status === "writing"
                                        ? "bg-blue-500/10 text-blue-600"
                                        : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {StatusLabelMap[plan.status]?.text}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditPlanId(plan.id);
                            }}
                            disabled={isAutoWriting}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover/plan-item:opacity-100 hover:bg-muted transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Chỉnh sửa kế hoạch chương"
                          >
                            <PencilIcon className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      );
                    })}
                </div>
                {/* Generate more chapter plans button */}
              </ScrollArea>
              {chapterPlans && chapterPlans.length > 0 && (
                <div className="flex gap-1 mx-2 my-2">
                  <button
                    type="button"
                    onClick={() => setGenerateMorePlansOpen(true)}
                    disabled={isGeneratingPlans || isAutoWriting}
                    className="flex-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {isGeneratingPlans
                      ? "Đang tạo..."
                      : "+ Tạo thêm (AI)"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextOrder = Math.max(...chapterPlans.map((p) => p.chapterOrder)) + 1;
                      await createChapterPlan({
                        novelId,
                        chapterOrder: nextOrder,
                        directions: [],
                        outline: "",
                        scenes: [],
                        status: "planned",
                      });
                    }}
                    disabled={isAutoWriting}
                    className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + Thêm trống
                  </button>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel minSize="300px" className="h-full min-h-0">
            <Tabs
              value={activePanel}
              onValueChange={(v) => setActivePanel(v as typeof activePanel)}
              className="flex h-full min-h-0 flex-col"
            >
              <TabsList className="mx-auto mt-2 max-w-full w-fit shrink-0 flex-wrap justify-center gap-0.5 px-1 [&_button]:text-xs [&_button]:px-2 sm:[&_button]:min-w-20">
                <TabsTrigger value="context">Bối cảnh</TabsTrigger>
                <TabsTrigger value="pipeline">Hướng đi</TabsTrigger>
                <TabsTrigger value="outline">Giàn ý</TabsTrigger>
                <TabsTrigger value="content">Nội dung</TabsTrigger>
                <TabsTrigger value="review">Đánh giá</TabsTrigger>
              </TabsList>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <TabsContent
                  value="context"
                  className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <ScrollArea className={writingTabsScrollClass}>
                    <div className="p-4">
                      <ContextStepPanel
                        key={`${activeSession?.id ?? "nosess"}-${effectivePlanId ?? "noplan"}`}
                        novelId={novelId}
                        effectivePlanId={effectivePlanId}
                        activeSession={activeSession}
                        isRunning={isRunning}
                        smartWritingMode={Boolean(
                          writingSettings?.smartWritingMode,
                        )}
                        contextResult={resultMap.get("context")}
                        contextOutput={contextOutput}
                        pipelinePreRunRole={pipelinePreRunRole}
                        onStartPipeline={() => void handleStartPipeline()}
                        onRerunContext={() => void handleRerunContext()}
                      />
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent
                  value="pipeline"
                  className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <ScrollArea className={writingTabsScrollClass}>
                    <div className="p-4 min-w-0">
                      {currentPlan?.directions && currentPlan.directions.length > 0 ? (
                        <div className="space-y-4 mx-auto max-w-lg">
                          <DirectionPreFilter novelId={novelId} chapterPlanId={effectivePlanId || undefined} hideCharacters={true} />


                          <Button
                            type="button"
                            size="sm"
                            className="w-full text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white py-2 flex items-center justify-center gap-1.5 shadow-sm transition-all"
                            onClick={async () => {
                              let sessionId = activeSession?.id;
                              if (!sessionId) {
                                await getOrCreateWritingSettings(novelId);
                                sessionId = await createWritingSession({
                                  novelId,
                                  chapterPlanId: currentPlan.id,
                                  currentStep: "context",
                                  status: "active",
                                });
                              }

                              const prePlannedOutput = {
                                options: [
                                  {
                                    id: "pre-planned",
                                    title: "Hướng đi định sẵn",
                                    description: currentPlan.directions.join("; "),
                                    plotImpact: "",
                                    characters: [],
                                    type: "character-development",
                                  }
                                ],
                                recommendedOptionIds: ["pre-planned"],
                              };

                              await db.writingStepResults.put({
                                id: crypto.randomUUID(),
                                sessionId,
                                role: "direction",
                                status: "completed",
                                output: JSON.stringify(prePlannedOutput),
                                startedAt: new Date(),
                                completedAt: new Date(),
                              });

                              await db.writingSessions.update(sessionId, {
                                currentStep: "outline",
                                updatedAt: new Date(),
                              });

                              void handleStartPipeline(currentPlan.id);
                            }}
                          >
                            Tiếp tục chạy Pipeline (Tạo Giàn ý)
                          </Button>
                        </div>
                      ) : pipelinePreRunRole === "direction" ||
                      (sessionNeedsResume &&
                        activeSession?.currentStep === "direction" &&
                        resultMap.get("direction")?.status !== "completed") ? (
                        <div className="space-y-4 mx-auto max-w-lg">
                          <DirectionPreFilter novelId={novelId} chapterPlanId={effectivePlanId || undefined} />
                          <PipelineStepConfig
                            novelId={novelId}
                            role="direction"
                            instructionKey="direction"
                            title={
                              directionOutput
                                ? "Tạo lại hướng đi"
                                : "Đề xuất hướng đi"
                            }
                            description={
                              directionOutput
                                ? "Chỉnh mô hình, yêu cầu và system prompt, sau đó chạy AI."
                                : "Cấu hình bước này rồi chạy để AI đề xuất các hướng đi."
                            }
                            runLabel={
                              directionOutput
                                ? "Chạy AI"
                                : "Chạy pipeline (tiếp tục)"
                            }
                            onRun={() => void handleStartPipeline()}
                            disabled={isRunning}
                          />
                        </div>
                      ) : directionOutput ? (
                        <DirectionSelector
                          options={directionOutput.options}
                          recommendedOptionIds={
                            directionOutput.recommendedOptionIds
                          }
                          onConfirm={handleDirectionConfirm}
                          onRegenerateAction={handleRerunDirection}
                          isLoading={isRunning}
                        />
                      ) : isRunning &&
                        activeSession?.currentStep === "context" ? (
                        <Empty className="h-[60vh]">
                          <EmptyMedia variant="icon">
                            <CompassIcon />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>Đang tạo bối cảnh</EmptyTitle>
                            <EmptyDescription>
                              Mở tab &quot;Bối cảnh&quot; để xem tiến trình. Sau
                              khi xong, hướng đi sẽ chạy tại đây nếu pipeline
                              tiếp tục.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : isRunning &&
                        activeSession?.currentStep === "direction" ? (
                        <Empty className="h-[60vh]">
                          <EmptyMedia>
                            <Loader2Icon className="h-10 w-10 animate-spin text-primary" />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>Đang đề xuất hướng đi</EmptyTitle>
                            <EmptyDescription>
                              AI đang sáng tạo các hướng đi cho chương mới…
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : !activeSession && effectivePlanId ? (
                        <Empty className="h-[60vh]">
                          <EmptyMedia variant="icon">
                            <CompassIcon />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>Bắt đầu từ bối cảnh</EmptyTitle>
                            <EmptyDescription>
                              Mở tab &quot;Bối cảnh&quot; để cấu hình và chạy
                              bước đầu tiên, rồi quay lại đây chọn hướng đi.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : activeSession && effectivePlanId && !isRunning ? (
                        <div className="space-y-4 mx-auto max-w-lg">
                          <DirectionPreFilter novelId={novelId} chapterPlanId={effectivePlanId || undefined} />
                          <PipelineStepConfig
                            novelId={novelId}
                            role="direction"
                            instructionKey="direction"
                            title="Hướng đi"
                            description="Giữ bối cảnh đã có, xóa hướng đi và các bước sau."
                            runLabel="Chạy lại hướng đi"
                            onRun={() => void handleRerunDirection()}
                            disabled={isRunning}
                          />
                        </div>
                      ) : (
                        <Empty className="h-[60vh]">
                          <EmptyMedia variant="icon">
                            <CompassIcon />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>Chọn hướng đi</EmptyTitle>
                            <EmptyDescription>
                              Chọn kế hoạch chương ở sidebar, hoàn tất bước bối
                              cảnh (tab Bối cảnh), sau đó cấu hình hướng đi tại
                              đây hoặc nhấn &quot;Chạy pipeline&quot;.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent
                  value="outline"
                  className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <ScrollArea className={writingTabsScrollClass}>
                    <div className="p-4">
                      {pipelinePreRunRole === "outline" ? (
                        <PipelineStepConfig
                          novelId={novelId}
                          role="outline"
                          instructionKey="outline"
                          title="Tạo lại giàn ý"
                          description="Chỉnh cấu hình rồi chạy lại bước giàn ý."
                          runLabel="Chạy AI"
                          onRun={() => void handleStartPipeline()}
                          disabled={isRunning}
                        />
                      ) : outlineOutput ? (
                        <OutlineEditor
                          chapterTitle={outlineOutput.chapterTitle}
                          synopsis={outlineOutput.synopsis}
                          scenes={outlineOutput.scenes}
                          onApprove={handleOutlineApprove}
                          onRegenerateAction={handleRerunOutline}
                          isLoading={isRunning}
                        />
                      ) : isRunning &&
                        activeSession?.currentStep === "outline" ? (
                        <Empty className="h-[60vh]">
                          <EmptyMedia>
                            <Loader2Icon className="h-10 w-10 animate-spin text-primary" />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>Đang tạo giàn ý</EmptyTitle>
                            <EmptyDescription>
                              AI đang xây dựng cấu trúc phân cảnh chi tiết...
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      ) : (
                        <PipelineStepConfig
                          novelId={novelId}
                          role="outline"
                          instructionKey="outline"
                          title="Giàn ý chương"
                          description="Giàn ý xuất hiện sau khi bạn chọn hướng đi. Bạn có thể cấu hình sẵn prompt và yêu cầu cho bước này."
                          runLabel="Chạy pipeline (tiếp tục)"
                          onRun={() => void handleStartPipeline()}
                          disabled={isRunning || !activeSession}
                        />
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent
                  value="content"
                  className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  {pipelinePreRunRole === "writer" ? (
                    <ScrollArea className={writingTabsScrollClass}>
                      <div className="p-4">
                        <PipelineStepConfig
                          novelId={novelId}
                          role="writer"
                          instructionKey="writer"
                          title="Tạo lại nội dung"
                          description="Chỉnh cấu hình rồi chạy lại bước viết chương."
                          runLabel="Chạy AI"
                          onRun={() => void handleStartPipeline()}
                          disabled={isRunning}
                        />
                      </div>
                    </ScrollArea>
                  ) : showWriterSetupOnContentTab ? (
                    <ScrollArea className={writingTabsScrollClass}>
                      <div className="p-4">
                        <PipelineStepConfig
                          novelId={novelId}
                          role="writer"
                          instructionKey="writer"
                          title="Viết chương"
                          description="Bước Viết chưa có nội dung hợp lệ (hoặc phiên đã lỗi). Cấu hình model và prompt rồi chạy lại."
                          runLabel="Chạy pipeline (tiếp tục)"
                          onRun={() => void handleStartPipeline()}
                          disabled={isRunning || !activeSession}
                        />
                      </div>
                    </ScrollArea>
                  ) : (
                    <div
                      className={`${writingTabsScrollClass} flex shrink-0 flex-col overflow-hidden`}
                    >
                      <ChapterPreview
                        sessionId={activeSession?.id}
                        assumeStreaming={
                          isRunning && activeSession?.currentStep === "writer"
                        }
                        isRewriting={isRewriting}
                        onSaveAction={handleSaveChapter}
                        onPromptConfigAction={() => {
                          setSelectedSettingsRole("writer");
                          setSettingsOpen(true);
                        }}
                        onRegenerateAction={
                          activeSession && !isRunning && !isRewriting
                            ? handleRerunWriter
                            : undefined
                        }
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent
                  value="review"
                  className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <ScrollArea className={writingTabsScrollClass}>
                    <div className="p-4">
                      {pipelinePreRunRole === "review" ? (
                        <PipelineStepConfig
                          novelId={novelId}
                          role="review"
                          instructionKey="review"
                          title="Tạo lại đánh giá"
                          description="Chỉnh cấu hình rồi chạy lại bước đánh giá."
                          runLabel="Chạy AI"
                          onRun={() => void handleStartPipeline()}
                          disabled={isRunning}
                        />
                      ) : writerOutputDone &&
                        !reviewOutputDone &&
                        !isRunning &&
                        activeSession ? (
                        <PipelineStepConfig
                          novelId={novelId}
                          role="review"
                          instructionKey="review"
                          title="Đánh giá chương"
                          description="Cấu hình model và yêu cầu trước khi AI đánh giá bản nháp."
                          runLabel="Chạy pipeline (tiếp tục)"
                          onRun={() => void handleStartPipeline()}
                          disabled={isRunning || !activeSession}
                        />
                      ) : (
                        <ReviewPanel
                          sessionId={activeSession?.id}
                          onRewriteAction={handleRewrite}
                          onSaveAction={handleSaveChapter}
                          onPromptConfigAction={() => {
                            setSelectedSettingsRole("review");
                            setSettingsOpen(true);
                          }}
                          onRegenerateReviewAction={
                            activeSession && !isRunning
                              ? handleRerunReview
                              : undefined
                          }
                          isRewriting={isRewriting}
                        />
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </div>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Settings Dialog */}
      <WritingSettingsDialog
        novelId={novelId}
        open={settingsOpen}
        onOpenChangeAction={setSettingsOpen}
        initialRole={selectedSettingsRole}
      />

      <AlertDialog
        open={refreshSessionOpen}
        onOpenChange={setRefreshSessionOpen}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Làm mới phiên viết?</AlertDialogTitle>
            <AlertDialogDescription className="text-left sm:text-left">
              Toàn bộ kết quả các bước pipeline (bối cảnh, hướng đi, giàn ý, nội
              dung, đánh giá, viết lại) của phiên này sẽ bị xóa. Hướng đi và
              giàn ý trên kế hoạch chương cũng được xóa; trạng thái kế hoạch về
              &quot;Dự định&quot;. Phiên bắt đầu lại từ bước Bối cảnh.
              {isRunning ? (
                <>
                  {" "}
                  <span className="font-medium text-amber-600 dark:text-amber-500">
                    Pipeline đang chạy sẽ bị dừng.
                  </span>
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirmRefreshSession()}
            >
              Làm mới phiên
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GenerateMorePlansDialog
        novelId={novelId}
        open={generateMorePlansOpen}
        onOpenChangeAction={setGenerateMorePlansOpen}
        onConfirmAction={async (userInstruction: string) => {
          setGenerateMorePlansOpen(false);
          await runGenerateMorePlans(userInstruction);
        }}
        isLoading={isGeneratingPlans}
      />

      {/* Edit Chapter Plan Dialog */}
      <EditChapterPlanDialog
        plan={chapterPlans?.find((p) => p.id === editPlanId) ?? null}
        open={editPlanId !== null}
        onOpenChangeAction={(open) => {
          if (!open) setEditPlanId(null);
        }}
      />

      {/* Stale Context Warning */}
      <AlertDialog open={staleWarning} onOpenChange={setStaleWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dữ liệu đã thay đổi</AlertDialogTitle>
            <AlertDialogDescription>
              Dữ liệu tiểu thuyết đã thay đổi kể từ khi bối cảnh được tạo. Bạn
              muốn chạy lại bước Bối cảnh hay tiếp tục với bối cảnh cũ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setStaleWarning(false);
                handleStartPipeline();
              }}
            >
              Tiếp tục với bối cảnh cũ
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleStaleRerun}>
              Chạy lại bước Bối cảnh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overall Evaluation Dialog */}
      <Dialog open={showOverallEvalDialog} onOpenChange={setShowOverallEvalDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-background">
          <DialogHeader className="px-6 py-5 border-b shrink-0 bg-muted/20">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-violet-600 dark:text-violet-400">
              📊 Đánh giá tổng quát các chương mới viết
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="rounded-xl border bg-muted/10 p-5 leading-relaxed text-sm prose dark:prose-invert max-w-none">
              {overallEvalResult ? (
                <div className="whitespace-pre-wrap">{overallEvalResult}</div>
              ) : (
                <div className="text-center text-muted-foreground py-10 flex flex-col items-center gap-2">
                  <Loader2Icon className="size-8 animate-spin text-violet-500" />
                  <p>Đang chuẩn bị báo cáo đánh giá tổng quát...</p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="text-sm font-bold text-foreground block">
                ✍️ Chỉ dẫn chỉnh sửa từ người dùng
              </label>
              <textarea
                value={overallEvalFeedback}
                onChange={(e) => setOverallEvalFeedback(e.target.value)}
                placeholder="Ví dụ: Chương 1 hơi nhanh, hãy bổ sung thêm đoạn hội thoại giữa nhân vật A và B để làm rõ động cơ. Hoặc: Đổi xưng hô của nhân vật C thành 'y'..."
                className="w-full min-h-[100px] rounded-lg border bg-background p-3 text-sm focus:ring-1 focus:ring-violet-500 focus-visible:outline-none leading-relaxed"
                disabled={isApplyingOverallFixes}
              />
            </div>

            {isApplyingOverallFixes && (
              <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-violet-600 dark:text-violet-400">
                  <Loader2Icon className="size-4 animate-spin" />
                  <span>AI đang tiến hành sửa đổi hàng loạt...</span>
                </div>
                <p className="text-xs text-muted-foreground leading-normal">{overallFixesProgress}</p>
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t shrink-0 flex !justify-between bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOverallEvalDialog(false)}
              disabled={isApplyingOverallFixes}
              className="text-xs"
            >
              Đóng
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                if (!overallEvalFeedback.trim()) {
                  toast.error("Vui lòng nhập chỉ dẫn chỉnh sửa.");
                  return;
                }
                setIsApplyingOverallFixes(true);
                setOverallFixesProgress("Bắt đầu khởi chạy quá trình sửa đổi...");
                try {
                  const { applyOverallEvaluationFixes } = await import("@/lib/writing/overall-eval");
                  await applyOverallEvaluationFixes(
                    novelId,
                    overallEvalChapters,
                    overallEvalFeedback,
                    (msg) => setOverallFixesProgress(msg)
                  );
                  toast.success("Đã hoàn tất tự động chỉnh sửa hàng loạt!");
                  setShowOverallEvalDialog(false);
                  setOverallEvalFeedback("");
                } catch (err) {
                  toast.error("Lỗi khi chỉnh sửa: " + (err instanceof Error ? err.message : String(err)));
                } finally {
                  setIsApplyingOverallFixes(false);
                }
              }}
              disabled={isApplyingOverallFixes || !overallEvalResult}
              className="text-xs bg-violet-600 hover:bg-violet-700 text-white font-semibold flex items-center gap-1.5"
            >
              {isApplyingOverallFixes ? (
                <>
                  <Loader2Icon className="size-3 animate-spin" />
                  Đang sửa đổi...
                </>
              ) : (
                <>
                  ⚡ Chỉnh sửa theo ý kiến người dùng
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
