"use client";

import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useChapterPlans,
  useChapters,
  useCharacters,
  useNovel,
  usePlotArcs,
} from "@/lib/hooks";
import { generateFromExisting, generateAllFromScratch } from "@/lib/writing/auto-generate";
import { runRewritePipeline } from "@/lib/writing/rewrite-orchestrator";
import { db } from "@/lib/db";
import { useRewriteStore } from "@/lib/stores/rewrite-store";
import {
  AlertTriangleIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  GlobeIcon,
  Loader2Icon,
  MapIcon,
  MessageSquareIcon,
  PlayIcon,
  RotateCcwIcon,
  SkipForwardIcon,
  SparklesIcon,
  UsersIcon,
  StopCircleIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { StepModelPicker } from "./writing-settings-dialog";
import { Slider } from "@/components/ui/slider";

type DashboardAction = "auto-generate" | "chat" | "rewrite" | "skip";

export function NovelSetup({
  novelId,
  onActionAction,
  forceRewriteMode,
}: {
  novelId: string;
  onActionAction?: (action: DashboardAction, startStep?: string) => void;
  forceRewriteMode?: boolean;
}) {
  const novel = useNovel(novelId);
  const chapters = useChapters(novelId);
  const characters = useCharacters(novelId);
  const plotArcs = usePlotArcs(novelId);
  const chapterPlans = useChapterPlans(novelId);
  
  const standardChaptersCount = useLiveQuery(
    () => db.chapters.where("novelId").equals(novelId).and(c => !c.isAiWritten).count(),
    [novelId]
  ) ?? 0;

  const isRewriteProject = forceRewriteMode || !!novel?.referenceNovelId || standardChaptersCount > 0;
  const { isGenerating: isRewriting, setGenerating: setRewriting, phase: rewritePhase, setPhase: setRewritePhase, abort: abortRewrite } = useRewriteStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState<string>("");
  const [showAutoOptions, setShowAutoOptions] = useState(false);
  const [idea, setIdea] = useState("");
  const [adherence, setAdherence] = useState([70]);
  const [chapterCount, setChapterCount] = useState(10);
  const [autoExtractNames, setAutoExtractNames] = useState(true);
  const [enableNsfw, setEnableNsfw] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const hasWorld = !!(novel?.worldOverview || novel?.factions?.length);
  const hasCharacters = (characters?.length ?? 0) > 0;
  const hasPlotArcs = (plotArcs?.length ?? 0) > 0;
  const hasChapterPlans = (chapterPlans?.length ?? 0) > 0;
  const hasChapters = (chapters?.length ?? 0) > 0;
  const hasEnoughForWriting = hasChapterPlans && hasPlotArcs;
  const hasPartialData = hasWorld || hasCharacters || hasChapters;

  const steps = [
    {
      key: "world",
      label: "Thế giới quan",
      icon: GlobeIcon,
      done: hasWorld,
      detail: hasWorld
        ? `${novel?.factions?.length ?? 0} thế lực, ${novel?.keyLocations?.length ?? 0} địa danh`
        : "Chưa có",
    },
    {
      key: "characters",
      label: "Nhân vật",
      icon: UsersIcon,
      done: hasCharacters,
      detail: hasCharacters ? `${characters?.length} nhân vật` : "Chưa có",
    },
    {
      key: "arcs",
      label: "Hướng đi nhân vật",
      icon: MapIcon,
      done: hasPlotArcs,
      detail: hasPlotArcs ? `${plotArcs?.length} mạch hành trình` : "Chưa có",
    },
    {
      key: "plans",
      label: "Kế hoạch chương",
      icon: BookOpenIcon,
      done: hasChapterPlans,
      detail: hasChapterPlans ? `${chapterPlans?.length} chương` : "Chưa có",
    },
  ];

  const handleAutoGenerate = useCallback(async (mode: "continue" | "fresh" = "continue") => {
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (mode === "fresh") {
        await generateAllFromScratch(novelId, {
          idea,
          targetChapterCount: chapterCount,
          abortSignal: controller.signal,
          onPhase: (phase) => {
            const labels = {
              world: "thế giới quan",
              characters: "nhân vật",
              arcs: "mạch truyện",
              plans: "kế hoạch chương",
            };
            setGenPhase(labels[phase] || "");
          },
        });
        toast.success("Đã tự động tạo toàn bộ nội dung truyện");
      } else {
        if (idea.trim()) {
          const updateData: any = { updatedAt: new Date() };
          if (isRewriteProject) updateData.rewriteIdea = idea;
          else updateData.synopsis = idea;
          await db.novels.update(novelId, updateData);
        }
        await generateFromExisting(novelId, {
          abortSignal: controller.signal,
          mode: "continue",
          onPhase: (phase) =>
            setGenPhase(phase === "arcs" ? "mạch truyện" : "kế hoạch chương"),
        });
        toast.success("Đã tiếp tục tạo mạch truyện và kế hoạch chương");
      }
      setShowAutoOptions(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setIsGenerating(false);
      setGenPhase("");
    }
  }, [novelId, idea, chapterCount, isRewriteProject]);

  const handleAutoRewrite = useCallback(async () => {
    const controller = new AbortController();
    setRewriting(true, novelId, controller);
    abortRef.current = controller;

    try {
      if (isRewriteProject) {
        const rewriteIdea = `Yêu cầu viết lại: Mức độ bám sát bản gốc: ${adherence[0]}%. Mức độ sáng tạo, mở rộng nội dung thêm thắt: ${100 - adherence[0]}%.`;
        await db.novels.update(novelId, { rewriteIdea, updatedAt: new Date() });
      } else if (idea.trim()) {
        await db.novels.update(novelId, { rewriteIdea: idea, updatedAt: new Date() });
      }
      
      await runRewritePipeline({
        novelId,
        maxChapters: chapterCount > 0 ? chapterCount : undefined,
        abortSignal: controller.signal,
        autoExtractNames: autoExtractNames,
        enableNsfw,
        onPhase: (phase) => setRewritePhase(phase),
      });
      
      toast.success("Đã hoàn tất tiến trình Rewrite truyện!");
      setShowAutoOptions(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setRewriting(false);
      setRewritePhase("");
    }
  }, [novelId, idea, chapterCount, autoExtractNames, adherence, isRewriteProject, enableNsfw]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-lg p-6 space-y-6">
        {/* Status cards */}
        {!isRewriteProject && (
          <div>
            <h3 className="text-sm font-medium mb-3">Trạng thái dữ liệu</h3>
          <div className="grid grid-cols-2 gap-2">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <Card
                  key={step.key}
                  className={`text-sm cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-all duration-200 ${
                    step.done ? "border-green-500/20 bg-green-50/10 dark:bg-green-950/5" : ""
                  }`}
                  onClick={() => onActionAction?.("chat", step.key)}
                  title={`Nhấp để tùy chỉnh / chỉnh sửa ${step.label.toLowerCase()}`}
                >
                  <CardHeader className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0" />
                      <CardTitle className="text-xs flex-1">
                        {step.label}
                      </CardTitle>
                      {step.done ? (
                        <CheckCircle2Icon className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertTriangleIcon className="h-4 w-4 text-yellow-500" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-3 pb-2 pt-0">
                    <p className="text-xs text-muted-foreground">
                      {step.detail}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

        {/* Actions */}
        {hasEnoughForWriting ? (
          <Button
            onClick={() => onActionAction?.("skip")}
            className="w-full"
            size="lg"
          >
            <SkipForwardIcon className="h-4 w-4 mr-2" />
            Bắt đầu viết
          </Button>
        ) : (
          <div className="space-y-3">
            {!showAutoOptions && !isGenerating && !isRewriteProject && (
              <>
                <Button
                  variant="default"
                  onClick={() => onActionAction?.("chat")}
                  className="w-full"
                  size="lg"
                >
                  <MessageSquareIcon className="h-4 w-4 mr-2" />
                  Tiếp tục setup
                </Button>

                <Button
                  onClick={() => {
                    setIdea(isRewriteProject ? (novel?.rewriteIdea || "") : (novel?.synopsis || novel?.description || ""));
                    setChapterCount(50);
                    setShowAutoOptions(true);
                  }}
                  className="w-full"
                  size="lg"
                  variant="secondary"
                >
                  <SparklesIcon className="h-4 w-4 mr-2" />
                  {isRewriteProject ? "Tự động Rewrite toàn bộ" : "Tự động tạo toàn bộ"}
                </Button>
              </>
            )}

            {!showAutoOptions && !isGenerating && !isRewriting && isRewriteProject && (
              <Button
                onClick={() => {
                  setIdea(novel?.rewriteIdea || "");
                  setChapterCount(0);
                  setShowAutoOptions(true);
                }}
                className="w-full"
                size="lg"
                variant="secondary"
              >
                <SparklesIcon className="h-4 w-4 mr-2" />
                Mở bảng thiết lập Rewrite
              </Button>
            )}

            {showAutoOptions && !isGenerating && (
              <div className="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                <p className={`text-xs font-bold uppercase tracking-wider text-center ${isRewriteProject ? 'text-amber-600 dark:text-amber-400' : 'text-violet-600 dark:text-violet-400'}`}>
                  🪄 {isRewriteProject ? "Tự động Rewrite truyện" : "Tự động tạo toàn bộ truyện"}
                </p>
                <p className="text-[11px] text-muted-foreground text-center">
                  {isRewriteProject 
                    ? "Nhập ý tưởng mới nếu muốn đổi cốt truyện. Nếu để TRỐNG, AI sẽ tự động đọc truyện gốc và phóng tác lại 100% cốt truyện cũ bằng văn phong mới để tránh bản quyền."
                    : "Nhập ý tưởng và số chương. AI sẽ tự động thiết lập Thế giới quan, Nhân vật, Hướng đi nhân vật và Kế hoạch chương trong một lần chạy duy nhất."}
                </p>

                <div className="space-y-1.5 flex flex-col justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    {isRewriteProject ? "Độ bám sát bản gốc (1-100%)" : "Ý tưởng chính / Cốt truyện"}
                    {isRewriteProject && <span className="text-[10px] font-normal text-muted-foreground">(Tùy chọn)</span>}
                  </label>
                  
                  {isRewriteProject ? (
                    <div className="space-y-4 pt-2">
                      <Slider 
                        defaultValue={[70]}
                        value={adherence}
                        min={1}
                        max={100}
                        step={1}
                        onValueChange={setAdherence}
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                        <span>Sáng tạo nhiều</span>
                        <span className="text-primary font-bold">{adherence[0]}% bám sát</span>
                        <span>Giữ y nguyên</span>
                      </div>
                    </div>
                  ) : (
                    <textarea
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                      placeholder="Ví dụ: Một tu sĩ xuyên không vào cơ thể phế vật ở hiện đại..."
                      rows={4}
                      className="w-full rounded-md border bg-background px-3 py-2 text-xs focus:ring-1 focus:ring-primary focus-visible:outline-none resize-none"
                    />
                  )}
                </div>

                  {isRewriteProject && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">AI Viết Truyện (Rewrite)</p>
                      <StepModelPicker novelId={novelId} role="rewrite" />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      {isRewriteProject ? "Số chương muốn Rewrite (Nhập 0 để chạy toàn bộ chương có sẵn)" : "Số lượng chương mong muốn"}
                    </label>
                    <input
                      type="number"
                      value={chapterCount}
                      onChange={(e) => setChapterCount(Math.max(0, parseInt(e.target.value) || 0))}
                      min={0}
                      max={isRewriteProject ? 5000 : 100}
                      className="w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary focus-visible:outline-none"
                    />
                  </div>

                  {isRewriteProject && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-start gap-2 mb-3">
                        <input 
                          type="checkbox" 
                          id="enableNsfwRewrite" 
                          checked={enableNsfw}
                          onChange={(e) => setEnableNsfw(e.target.checked)}
                          className="rounded border-gray-300 text-rose-600 focus:ring-rose-500 h-3.5 w-3.5 mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <label htmlFor="enableNsfwRewrite" className="text-xs font-bold text-rose-600 dark:text-rose-400 cursor-pointer select-none">
                            Bật chế độ NSFW (R-18+)
                          </label>
                          <p className="text-[10px] text-muted-foreground leading-tight">Yêu cầu AI viết cảnh H bạo dạn, trần trụi và chi tiết hơn. (Cần dùng model không kiểm duyệt)</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <input 
                          type="checkbox" 
                          id="autoExtract" 
                          checked={autoExtractNames}
                          onChange={(e) => setAutoExtractNames(e.target.checked)}
                          className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5 mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <label htmlFor="autoExtract" className="text-xs font-semibold cursor-pointer select-none">
                            Trích xuất Danh từ riêng tự động
                          </label>
                          <p className="text-[10px] text-muted-foreground leading-tight">AI sẽ đọc chương vừa viết, nhặt ra Tên nhân vật, Địa danh, Vật phẩm... và lưu vào Thiết lập Truyện.</p>
                        </div>
                      </div>

                      {autoExtractNames && (
                        <div className="pt-2 mt-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">AI Trích xuất Dữ liệu</p>
                          <StepModelPicker novelId={novelId} role="rewrite_extract" />
                        </div>
                      )}
                    </div>
                  )}

                <div className="space-y-2 pt-2 border-t">
                  {isRewriteProject ? (
                    <>
                      <Button
                        onClick={handleAutoRewrite}
                        disabled={isRewriting}
                        className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white text-xs py-2"
                      >
                        {isRewriting ? (
                          <>
                            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                            {rewritePhase || "Đang viết..."}
                          </>
                        ) : (
                          <>
                            <SparklesIcon className="h-4 w-4" />
                            Bắt đầu Rewrite toàn bộ
                          </>
                        )}
                      </Button>
                    </>
                  ) : hasPartialData ? (
                    <>
                      <Button
                        onClick={() => handleAutoGenerate("continue")}
                        disabled={!idea.trim()}
                        className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs py-2"
                      >
                        <PlayIcon className="h-4 w-4" />
                        Viết tiếp truyện
                        <span className="text-[10px] opacity-80">(Giữ dữ liệu cũ, tạo thêm)</span>
                      </Button>
                      <Button
                        onClick={() => handleAutoGenerate("fresh")}
                        disabled={!idea.trim()}
                        className="w-full gap-2"
                        variant="outline"
                        size="lg"
                      >
                        <RotateCcwIcon className="h-4 w-4" />
                        Viết lại bộ mới
                        <span className="text-[10px] opacity-60">(Tạo lại Thế giới, Nhân vật, Mạch...)</span>
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => handleAutoGenerate("fresh")}
                      disabled={!idea.trim()}
                      className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white text-xs py-2"
                    >
                      <SparklesIcon className="h-4 w-4" />
                      Bắt đầu tự động tạo toàn bộ
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAutoOptions(false)}
                    className="w-full text-xs text-muted-foreground"
                  >
                    Hủy
                  </Button>
                </div>
              </div>
            )}

            {isGenerating && (
              <Button
                disabled
                className="w-full"
                size="lg"
                variant="secondary"
              >
                <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                Đang tạo {genPhase}...
              </Button>
            )}

            {isRewriting && (
              <div className="space-y-3 mt-4">
                <Button disabled className="w-full" size="lg" variant="secondary">
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  {rewritePhase || "Đang Rewrite..."}
                </Button>
                <Button 
                  onClick={abortRewrite}
                  variant="destructive"
                  className="w-full"
                >
                  <StopCircleIcon className="h-4 w-4 mr-2" />
                  Hủy (Dừng lại)
                </Button>
              </div>
            )}

          </div>
        )}

        {isGenerating && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => abortRef.current?.abort()}
            className="w-full"
          >
            Hủy
          </Button>
        )}
      </div>
    </ScrollArea>
  );
}
