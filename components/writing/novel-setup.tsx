"use client";

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
import { db } from "@/lib/db";
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
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

type DashboardAction = "auto-generate" | "chat" | "rewrite" | "skip";

export function NovelSetup({
  novelId,
  onActionAction,
}: {
  novelId: string;
  onActionAction: (action: DashboardAction, startStep?: string) => void;
}) {
  const novel = useNovel(novelId);
  const chapters = useChapters(novelId);
  const characters = useCharacters(novelId);
  const plotArcs = usePlotArcs(novelId);
  const chapterPlans = useChapterPlans(novelId);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState<string>("");
  const [showAutoOptions, setShowAutoOptions] = useState(false);
  const [idea, setIdea] = useState("");
  const [chapterCount, setChapterCount] = useState(50);
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
          await db.novels.update(novelId, { synopsis: idea, updatedAt: new Date() });
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
  }, [novelId, idea, chapterCount]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-lg p-6 space-y-6">
        {/* Status cards */}
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
                  onClick={() => onActionAction("chat", step.key)}
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

        {/* Summary */}
        {hasChapters && (
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-sm">
              Truyện đã có <strong>{chapters?.length} chương</strong>
              {hasCharacters && (
                <>
                  , <strong>{characters?.length} nhân vật</strong>
                </>
              )}
              {hasWorld && <>, thế giới quan đã thiết lập</>}.
              {!hasPlotArcs &&
                " Cần tạo mạch truyện và kế hoạch chương để bắt đầu viết tự động."}
            </p>
          </div>
        )}

        {/* Actions */}
        {hasEnoughForWriting ? (
          <Button
            onClick={() => onActionAction("skip")}
            className="w-full"
            size="lg"
          >
            <SkipForwardIcon className="h-4 w-4 mr-2" />
            Bắt đầu viết
          </Button>
        ) : (
          <div className="space-y-3">
            {!showAutoOptions && !isGenerating && (
              <>
                <Button
                  variant="default"
                  onClick={() => onActionAction("chat")}
                  className="w-full"
                  size="lg"
                >
                  <MessageSquareIcon className="h-4 w-4 mr-2" />
                  Tiếp tục setup
                </Button>

                <Button
                  onClick={() => {
                    setIdea(novel?.synopsis || novel?.description || "");
                    setChapterCount(50);
                    setShowAutoOptions(true);
                  }}
                  className="w-full"
                  size="lg"
                  variant="secondary"
                >
                  <SparklesIcon className="h-4 w-4 mr-2" />
                  Tự động tạo toàn bộ
                </Button>
              </>
            )}

            {showAutoOptions && !isGenerating && (
              <div className="rounded-xl border bg-card p-4 space-y-4 shadow-sm">
                <p className="text-xs font-bold text-foreground uppercase tracking-wider text-center text-violet-600 dark:text-violet-400">
                  🪄 Tự động tạo toàn bộ truyện
                </p>
                <p className="text-[11px] text-muted-foreground text-center">
                  Nhập ý tưởng và số chương. AI sẽ tự động thiết lập Thế giới quan, Nhân vật, Hướng đi nhân vật và Kế hoạch chương trong một lần chạy duy nhất.
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Ý tưởng chính / Cốt truyện
                  </label>
                  <textarea
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="Ví dụ: Một tu sĩ xuyên không vào cơ thể phế vật ở hiện đại, dùng thuật luyện đan để chữa bệnh cứu người và xây dựng tập đoàn dược phẩm..."
                    rows={4}
                    className="w-full rounded-md border bg-background px-3 py-2 text-xs focus:ring-1 focus:ring-primary focus-visible:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Số lượng chương mong muốn
                  </label>
                  <input
                    type="number"
                    value={chapterCount}
                    onChange={(e) => setChapterCount(Math.max(5, parseInt(e.target.value) || 5))}
                    min={5}
                    max={100}
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary focus-visible:outline-none"
                  />
                </div>

                <div className="space-y-2 pt-2 border-t">
                  {hasPartialData ? (
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
