"use client";

import { AddChapterDialog } from "@/components/add-chapter-dialog";
import { BulkAddChaptersDialog } from "@/components/bulk-add-chapters-dialog";
import { TranslateTabPanel } from "@/components/novel/translate-tab-panel";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { db, type Chapter } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { fuzzyMatch } from "@/lib/fuzzy";
import { deleteChapter, clearChapterTranslations, type ChapterAnalysisStatus } from "@/lib/hooks";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { useDebouncedValue } from "@/lib/hooks/use-debounce";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BookOpenIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  ClockIcon,
  FileTextIcon,
  ZapIcon,
  LanguagesIcon,
  PencilIcon,
  PlusIcon,
  ReplaceAllIcon,
  ScissorsIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
  WrenchIcon,
  XIcon,
  LoaderIcon,
  PlayIcon,
  PauseIcon,
  XCircleIcon,
  CheckIcon,
  EyeOffIcon,
  EyeIcon,
  EraserIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { CopyXIcon, CombineIcon } from "lucide-react";

const CHAPTER_PAGE_SIZE = 50;

const STATUS_CONFIG: Record<
  ChapterAnalysisStatus,
  { icon: React.ElementType; label: string; className: string }
> = {
  analyzed: {
    icon: CheckCircleIcon,
    label: "Đã phân tích",
    className: "text-green-500",
  },
  stale: {
    icon: ClockIcon,
    label: "Đã sửa đổi",
    className: "text-amber-500",
  },
  unanalyzed: {
    icon: CircleDashedIcon,
    label: "Chưa phân tích",
    className: "text-muted-foreground",
  },
};

function formatDateTime(date: Date | undefined) {
  if (!date) return null;
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTimeFull(date: Date | undefined) {
  if (!date) return "";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ChaptersTab({
  novelId,
  chapters,
  analysisStatuses,
  wordCounts,
  originalWordCounts,
  translatedChapterIds,
  onAnalyze,
  onTranslate,
  onReplace,
  onConvert,
  onQtTranslate,
  onPdfTranslate,
  onResplit,
  onSplitMultiple,
  onMergeMultiple,
  onMergeParts,
}: {
  novelId: string;
  chapters: Chapter[];
  analysisStatuses:
  | { chapterId: string; status: ChapterAnalysisStatus }[]
  | undefined;
  wordCounts: Map<string, number>;
  originalWordCounts?: Map<string, number>;
  translatedChapterIds?: Set<string>;
  onAnalyze: (
    mode: "full" | "incremental" | "selected",
    selectedIds?: string[],
  ) => void;
  onTranslate: (chapterIds: string[]) => void;
  onReplace?: (chapterIds: string[]) => void;
  onConvert?: (chapterIds: string[]) => void;
  onQtTranslate?: (chapterIds: string[]) => void;
  onPdfTranslate?: (chapterIds: string[]) => void;
  onResplit?: (chapterIds: string[]) => void;
  onSplitMultiple?: (chapterIds: string[]) => void;
  onMergeMultiple?: (chapterIds: string[]) => void;
  onMergeParts?: (chapterIds: string[]) => void;
}) {
  const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);
  const isEditMode = novel?.customTranslateMode === "edit";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkClearTranslationsOpen, setBulkClearTranslationsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showTranslateStatus, setShowTranslateStatus] = useState(true);
  const [visibleCount, setVisibleCount] = useState(CHAPTER_PAGE_SIZE);
  const debouncedQuery = useDebouncedValue(searchQuery, 350);

  const [activeSubTab, setActiveSubTab] = useState<"standard" | "ai">("standard");

  // Reset selection and visible page count when sub-tab changes
  useEffect(() => {
    setSelected(new Set());
    setVisibleCount(CHAPTER_PAGE_SIZE);
  }, [activeSubTab]);

  const standardChapters = useMemo(() => chapters.filter(c => !c.isAiWritten), [chapters]);
  const aiChapters = useMemo(() => chapters.filter(c => !!c.isAiWritten), [chapters]);
  const displayedChaptersList = activeSubTab === "standard" ? standardChapters : aiChapters;

  const translateJob = useBulkTranslateStore((s) => s.jobs[novelId]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const statusMap = useMemo(() => {
    const map = new Map<string, ChapterAnalysisStatus>();
    if (analysisStatuses) {
      for (const s of analysisStatuses) {
        map.set(s.chapterId, s.status);
      }
    }
    return map;
  }, [analysisStatuses]);

  /** Chapters filtered by fuzzy query, with pre-computed match indices. */
  const filteredChapters = useMemo(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      return displayedChaptersList.map((ch, i) => ({ chapter: ch, indices: [] as number[], originalIndex: i }));
    }
    const results: { chapter: Chapter; indices: number[]; originalIndex: number }[] = [];
    for (let i = 0; i < displayedChaptersList.length; i++) {
      const ch = displayedChaptersList[i];
      const { matched, indices } = fuzzyMatch(q, ch.title);
      if (matched) results.push({ chapter: ch, indices, originalIndex: i });
    }
    return results;
  }, [displayedChaptersList, debouncedQuery]);

  // Reset visibleCount when search changes
  useEffect(() => {
    setVisibleCount(CHAPTER_PAGE_SIZE);
  }, [debouncedQuery]);

  const displayedChaptersCount = Math.min(visibleCount, filteredChapters.length);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: displayedChaptersCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 52,
    overscan: 10,
    gap: 4,
  });

  // Observer for lazy loading more
  const observer = useRef<IntersectionObserver | null>(null);
  const lastItemRef = useCallback((node: HTMLDivElement | null) => {
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && visibleCount < filteredChapters.length) {
        setVisibleCount(prev => prev + CHAPTER_PAGE_SIZE);
      }
    });
    if (node) observer.current.observe(node);
  }, [visibleCount, filteredChapters.length]);

  const getStatus = (chapterId: string): ChapterAnalysisStatus =>
    statusMap.get(chapterId) ?? "unanalyzed";

  const needsAnalysisCount =
    analysisStatuses?.filter((s) => s.status !== "analyzed").length ?? 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const allIds = filteredChapters.map((f) => f.chapter.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

    if (allSelected) {
      // Deselect all currently filtered ones
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of allIds) next.delete(id);
        return next;
      });
    } else {
      // Select all filtered ones
      setSelected((prev) => new Set([...prev, ...allIds]));
    }
  };

  const isAllValidSelected = useMemo(() => {
    if (filteredChapters.length === 0) return false;
    const allIds = filteredChapters.map((f) => f.chapter.id);
    return allIds.every((id) => selected.has(id));
  }, [filteredChapters, selected]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteChapter(deleteTarget.id);
      toast.success("Đã xóa chương");
    } catch {
      toast.error("Xóa thất bại");
    }
    setDeleteTarget(null);
  };

  const selectDuplicates = async () => {
    const toastId = toast.loading("Đang quét nội dung các chương...");
    try {
      const activeScenes = await db.scenes
        .where("[novelId+isActive]")
        .equals([novelId, 1])
        .toArray();

      const seenContent = new Set<string>();
      const dupIds = new Set<string>();

      // Mặc định quét theo thứ tự order để giữ lại chương xuất hiện đầu tiên
      const chaptersByOrder = [...chapters].sort((a, b) => a.order - b.order);
      const sceneMap = new Map(activeScenes.map((s) => [s.chapterId, s]));

      for (const ch of chaptersByOrder) {
        const scene = sceneMap.get(ch.id);
        if (!scene || !scene.content) continue;

        // Chuẩn hóa: xóa toàn bộ khoảng trắng để so sánh chính xác dù có khác biệt về dòng/dấu cách
        const normalized = scene.content.replace(/\s+/g, "").trim();
        if (normalized.length < 50) continue; // Bỏ qua các chương quá ngắn (thường là lỗi hoặc thông báo)

        if (seenContent.has(normalized)) {
          dupIds.add(ch.id);
        } else {
          seenContent.add(normalized);
        }
      }

      if (dupIds.size > 0) {
        setSelected((prev) => new Set([...prev, ...dupIds]));
        toast.success(`Đã chọn ${dupIds.size} chương có nội dung trùng lặp.`, { id: toastId });
      } else {
        toast.info("Không tìm thấy chương trùng lặp nội dung.", { id: toastId });
      }
    } catch {
      toast.error("Lỗi khi quét chương trùng lặp", { id: toastId });
    }
  };

  const selectTranslationErrors = () => {
    if (!translateJob) {
      toast.info("Chưa có phiên dịch nào gần đây.");
      return;
    }

    const errorIds = new Set<string>();
    translateJob.statuses.forEach((status, chId) => {
      if (status === "error") {
        errorIds.add(chId);
      }
    });

    if (errorIds.size > 0) {
      setSelected((prev) => new Set([...prev, ...errorIds]));
      toast.success(`Đã chọn ${errorIds.size} chương bị lỗi.`);
    } else {
      toast.info("Không có chương nào bị lỗi.");
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    try {
      // Delete in parallel or sequentially. We do sequentially to avoid freezing DB
      for (const id of selected) {
        await deleteChapter(id);
      }
      toast.success(`Đã xóa ${selected.size} chương`);
      setSelected(new Set());
    } catch {
      toast.error("Xóa thất bại");
    }
    setBulkDeleteOpen(false);
  };

  const handleBulkClearTranslations = async () => {
    if (selected.size === 0) return;
    try {
      await clearChapterTranslations(Array.from(selected));
      toast.success(`Đã xóa bản dịch của ${selected.size} chương`);
    } catch {
      toast.error("Xóa bản dịch thất bại");
    }
    setBulkClearTranslationsOpen(false);
  };

  return (
    <div className="max-w-full overflow-x-hidden">
      {/* Sub-tabs for Chapter Types */}
      <div className="mb-4 flex gap-1 p-0.5 bg-muted/40 rounded-lg border w-full sm:w-fit animate-in fade-in duration-300">
        <button
          type="button"
          onClick={() => setActiveSubTab("standard")}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
            activeSubTab === "standard"
              ? "bg-background text-foreground shadow-sm border border-border/40"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          <LanguagesIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Chương dịch & gốc</span>
          <span className={`ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px text-[10px] font-bold ${
            activeSubTab === "standard"
              ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
              : "bg-muted/80 text-muted-foreground"
          }`}>
            {standardChapters.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("ai")}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
            activeSubTab === "ai"
              ? "bg-background text-foreground shadow-sm border border-border/40"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          }`}
        >
          <SparklesIcon className="size-3.5 text-violet-600 dark:text-violet-400" />
          <span>Chương viết bằng AI</span>
          <span className={`ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-px text-[10px] font-bold ${
            activeSubTab === "ai"
              ? "bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
              : "bg-muted/80 text-muted-foreground"
          }`}>
            {aiChapters.length}
          </span>
        </button>
      </div>

      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Thêm chương</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
          <FileTextIcon className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Thêm nhiều</span>
        </Button>
        <Button size="sm" variant="outline" onClick={selectDuplicates}>
          <CopyXIcon className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Chọn trùng lặp</span>
        </Button>
        <Button size="sm" variant="outline" className="text-red-600 dark:text-red-400 border-red-500/30" onClick={selectTranslationErrors}>
          <XCircleIcon className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">{isEditMode ? "Chọn lỗi biên tập" : "Chọn lỗi dịch"}</span>
        </Button>
        <Button size="sm" variant="outline" className="text-blue-600 dark:text-blue-400" onClick={() => setWorkspaceOpen(true)}>
          <ZapIcon className="size-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Khu Vực Dịch Truyện</span>
        </Button>
        {selected.size > 0 && onSplitMultiple && (
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-all duration-300 animate-in fade-in slide-in-from-left-2"
            onClick={() => onSplitMultiple(Array.from(selected))}
          >
            <ScissorsIcon className="size-3.5 sm:mr-1.5 animate-pulse" />
            <span>Tách chương hàng loạt ({selected.size})</span>
          </Button>
        )}
        {selected.size > 1 && onMergeParts && (
          <Button
            size="sm"
            variant="outline"
            className="text-indigo-600 dark:text-indigo-400 border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-950/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all duration-300 animate-in fade-in slide-in-from-left-2"
            onClick={() => onMergeParts(Array.from(selected))}
          >
            <CombineIcon className="size-3.5 sm:mr-1.5" />
            <span>Gộp phần đã tách</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="sm:hidden"
          onClick={toggleAll}
        >
          {isAllValidSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
        </Button>
        <div className="ml-auto flex gap-1.5 sm:gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={selected.size === 0}
                title={
                  selected.size === 0
                    ? "Chọn ít nhất một chương để xử lý"
                    : `Xử lý (${selected.size})`
                }
              >
                <WrenchIcon className="size-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Xử lý</span>({selected.size})
                <ChevronDownIcon className="ml-1 size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                onClick={() => onAnalyze("selected", Array.from(selected))}
              >
                <SearchIcon className="size-3.5" />
                Phân tích đã chọn
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-destructive"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <TrashIcon className="size-3.5" />
                Xóa đã chọn
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-amber-600"
                onClick={() => setBulkClearTranslationsOpen(true)}
              >
                <EraserIcon className="size-3.5" />
                {isEditMode ? "Xóa bản biên tập" : "Xóa bản dịch"}
              </button>
              {onReplace && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => onReplace(Array.from(selected))}
                >
                  <ReplaceAllIcon className="size-3.5" />
                  Thay thế đã chọn
                </button>
              )}
              {onResplit && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-primary"
                  onClick={() => onResplit(Array.from(selected))}
                >
                  <ScissorsIcon className="size-3.5" />
                  Gộp & Tách lại
                </button>
              )}
              {onSplitMultiple && selected.size >= 1 && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-emerald-600 dark:text-emerald-400"
                  onClick={() => onSplitMultiple(Array.from(selected))}
                >
                  <ScissorsIcon className="size-3.5" />
                  {selected.size === 1 ? "Tách chương" : "Tách chương hàng loạt"}
                </button>
              )}
              {onMergeParts && selected.size > 1 && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-indigo-600 dark:text-indigo-400"
                  onClick={() => onMergeParts(Array.from(selected))}
                >
                  <CombineIcon className="size-3.5" />
                  Gộp các phần đã tách
                </button>
              )}
              {onMergeMultiple && selected.size > 1 && (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-violet-600 dark:text-violet-400"
                  onClick={() => onMergeMultiple(Array.from(selected))}
                >
                  <CombineIcon className="size-3.5" />
                  Gộp thành 1 chương
                </button>
              )}
            </PopoverContent>
          </Popover>

          {needsAnalysisCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAnalyze("incremental")}
              title={`Phân tích còn lại (${needsAnalysisCount})`}
            >
              <SearchIcon className="size-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">
                Phân tích còn lại ({needsAnalysisCount})
              </span>
              <span className="sm:hidden">{needsAnalysisCount}</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAnalyze("full")}
            title="Phân tích tất cả"
          >
            <SearchIcon className="size-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Phân tích tất cả</span>
          </Button>

          {translateJob && (translateJob.isRunning || translateJob.step === "progress") && (
            <Button
              variant="outline"
              size="icon-sm"
              className="h-8 w-8 ml-1"
              title={showTranslateStatus ? "Ẩn trạng thái dịch" : "Hiện trạng thái dịch"}
              onClick={() => setShowTranslateStatus(!showTranslateStatus)}
            >
              {showTranslateStatus ? <EyeOffIcon className="size-4 text-muted-foreground" /> : <EyeIcon className="size-4 text-primary" />}
            </Button>
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-3 mx-1">
        <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm chương..."
          className="h-8 pl-8 text-sm"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>

      {/* Chapter list */}
      {chapters.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Chưa có chương nào. Thêm mới hoặc nhập tiểu thuyết.
        </p>
      ) : (
        <>
          {/* Header row — hidden on mobile since layout changes */}
          <div className="hidden min-w-0 items-center gap-2 px-3 pb-2 text-xs text-muted-foreground sm:flex">
            <Checkbox
              checked={isAllValidSelected}
              onCheckedChange={toggleAll}
              className="size-3.5 shrink-0"
            />
            <span className="w-8 shrink-0">#</span>
            <span className="min-w-0 flex-1">Tiêu đề</span>
            <span className="w-28 shrink-0 text-right">Số từ (Gốc/Dịch)</span>
            <span className="hidden w-20 shrink-0 text-right lg:block">
              Chỉnh sửa
            </span>
            <span className="hidden w-20 shrink-0 text-right lg:block">
              Phân tích
            </span>
            <span className="w-6 shrink-0 lg:hidden" />
            <span className="w-[4.5rem] shrink-0" />
          </div>

          {/* Virtualized chapter list */}
          <div
            ref={scrollContainerRef}
            className="h-[calc(100svh-320px)] min-h-[300px] overflow-auto scrollbar-thin scrollbar-thumb-primary/10 hover:scrollbar-thumb-primary/20"
          >
            {filteredChapters.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Không tìm thấy chương nào khớp với &ldquo;{searchQuery}&rdquo;.
              </p>
            ) : (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const { chapter: ch, indices, originalIndex } =
                    filteredChapters[virtualRow.index];
                  const status = getStatus(ch.id);
                  const statusCfg = STATUS_CONFIG[status];
                  const StatusIcon = statusCfg.icon;
                  const isExpanded = expandedId === ch.id;

                  const tlStatus = translateJob?.statuses.get(ch.id);
                  let TlBadge = null;
                  if (showTranslateStatus && tlStatus) {
                    if (tlStatus === "pending") TlBadge = <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground whitespace-nowrap">{isEditMode ? "Chờ biên tập" : "Chờ dịch"}</span>;
                    else if (tlStatus === "scanning") TlBadge = <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-purple-500/10 text-purple-600 whitespace-nowrap flex items-center gap-1"><LoaderIcon className="size-3 animate-spin" />Quét từ điển</span>;
                    else if (tlStatus === "scanned") TlBadge = <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-indigo-500/10 text-indigo-600 whitespace-nowrap">Đã quét (Chờ AI 1)</span>;
                    else if (tlStatus === "translating") TlBadge = <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-blue-500/10 text-blue-600 whitespace-nowrap flex items-center gap-1"><LoaderIcon className="size-3 animate-spin" />{isEditMode ? "Đang biên tập" : "Đang dịch"}</span>;
                    else if (tlStatus === "done") TlBadge = <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-600 whitespace-nowrap">{isEditMode ? "Đã biên tập" : "Đã dịch"}</span>;
                    else if (tlStatus === "error") TlBadge = <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-600 whitespace-nowrap">Lỗi</span>;
                  } else if (translatedChapterIds?.has(ch.id)) {
                    TlBadge = <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-600 whitespace-nowrap">{isEditMode ? "Đã biên tập" : "Đã dịch"}</span>;
                  }

                  return (
                    <div
                      key={ch.id}
                      data-index={virtualRow.index}
                      ref={virtualRow.index === displayedChaptersCount - 1 ? lastItemRef : virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div className="rounded-lg border bg-card/50">
                        {/* Mobile: two-line layout */}
                        <div className="sm:hidden">
                          <div
                            role="button"
                            tabIndex={0}
                            className="flex w-full cursor-pointer items-center gap-2 px-3 pt-2 pb-1 text-left"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : ch.id)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpandedId(isExpanded ? null : ch.id);
                              }
                            }}
                          >
                            <Checkbox
                              checked={selected.has(ch.id)}
                              onCheckedChange={() => toggleSelect(ch.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="size-3.5 shrink-0"
                            />
                            <span className="w-6 shrink-0 text-center text-xs text-muted-foreground font-mono">
                              {ch.order + 1}
                            </span>
                            {isExpanded ? (
                              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0 flex-1 flex items-center truncate text-sm font-medium">
                              <HighlightedText
                                text={ch.title}
                                indices={indices}
                              />
                              {TlBadge}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 px-3 pb-1.5 pl-[3.75rem]">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              {translatedChapterIds?.has(ch.id)
                                ? `${(originalWordCounts?.get(ch.id) ?? 0).toLocaleString()} gốc / ${(wordCounts.get(ch.id) ?? 0).toLocaleString()} ${isEditMode ? "biên tập" : "dịch"}`
                                : `${(originalWordCounts?.get(ch.id) ?? 0).toLocaleString()} từ`}
                            </span>
                            <StatusIcon
                              className={`ml-1 size-3 ${statusCfg.className}`}
                            />
                            <div className="ml-auto flex gap-0.5">
                              <Button variant="ghost" size="icon-xs" asChild>
                                <Link
                                  href={`/novels/${novelId}/read/${originalIndex + 1}${activeSubTab === "ai" ? "?mode=ai" : ""}`}
                                >
                                  <BookOpenIcon className="size-3.5" />
                                </Link>
                              </Button>
                              <Button variant="ghost" size="icon-xs" asChild>
                                <Link
                                  href={`/novels/${novelId}/chapters/${ch.id}`}
                                >
                                  <PencilIcon className="size-3.5" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setDeleteTarget(ch)}
                              >
                                <TrashIcon className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Desktop: single-line layout */}
                        <div className="hidden min-w-0 items-center gap-2 px-3 py-1.5 sm:flex">
                          <Checkbox
                            checked={selected.has(ch.id)}
                            onCheckedChange={() => toggleSelect(ch.id)}
                            className="size-3.5 shrink-0"
                          />
                          <span className="w-8 shrink-0 text-center text-xs text-muted-foreground font-mono">
                            {ch.order + 1}
                          </span>
                          <button
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : ch.id)
                            }
                          >
                            {isExpanded ? (
                              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate font-medium flex items-center gap-2">
                              <HighlightedText
                                text={ch.title}
                                indices={indices}
                              />
                              {TlBadge}
                            </span>
                          </button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground cursor-help">
                                {translatedChapterIds?.has(ch.id)
                                  ? `${(originalWordCounts?.get(ch.id) ?? 0).toLocaleString()} / ${(wordCounts.get(ch.id) ?? 0).toLocaleString()}`
                                  : (originalWordCounts?.get(ch.id) ?? 0).toLocaleString()}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {translatedChapterIds?.has(ch.id)
                                ? `Gốc: ${(originalWordCounts?.get(ch.id) ?? 0).toLocaleString()} từ / ${isEditMode ? "Biên tập" : "Dịch"}: ${(wordCounts.get(ch.id) ?? 0).toLocaleString()} từ`
                                : `Gốc: ${(originalWordCounts?.get(ch.id) ?? 0).toLocaleString()} từ ${isEditMode ? "(Chưa biên tập)" : "(Chưa dịch)"}`}
                            </TooltipContent>
                          </Tooltip>

                          {/* Edited time — only on wide screens */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="hidden w-20 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground lg:block">
                                {formatDateTime(ch.updatedAt)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatDateTimeFull(ch.updatedAt)}
                            </TooltipContent>
                          </Tooltip>

                          {/* Analyzed time — only on wide screens */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={`hidden w-20 shrink-0 items-center justify-end gap-1 text-[10px] tabular-nums lg:flex ${statusCfg.className}`}
                              >
                                <StatusIcon className="size-3" />
                                {ch.analyzedAt
                                  ? formatDateTime(ch.analyzedAt)
                                  : statusCfg.label}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {ch.analyzedAt
                                ? `${statusCfg.label} — ${formatDateTimeFull(ch.analyzedAt)}`
                                : statusCfg.label}
                            </TooltipContent>
                          </Tooltip>

                          {/* Compact status icon when date columns are hidden */}
                          <span className="flex w-6 shrink-0 justify-end lg:hidden">
                            <StatusIcon
                              className={`size-3.5 ${statusCfg.className}`}
                            />
                          </span>
                          <div className="flex w-[4.5rem] shrink-0 justify-end gap-0.5">
                            <Button variant="ghost" size="icon-xs" asChild title="Đọc">
                              <Link
                                href={`/novels/${novelId}/read/${originalIndex + 1}${activeSubTab === "ai" ? "?mode=ai" : ""}`}
                              >
                                <BookOpenIcon className="size-3.5" />
                              </Link>
                            </Button>
                            <Button variant="ghost" size="icon-xs" asChild title="Sửa">
                              <Link
                                href={`/novels/${novelId}/chapters/${ch.id}`}
                              >
                                <PencilIcon className="size-3.5" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setDeleteTarget(ch)}
                              title="Xóa"
                            >
                              <TrashIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Collapsible summary */}
                        {isExpanded && ch.summary && (
                          <div className="border-t px-4 py-2 sm:px-10">
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                              {ch.summary}
                            </p>
                          </div>
                        )}
                        {isExpanded && !ch.summary && (
                          <div className="border-t px-4 py-2 sm:px-10">
                            <p className="text-[11px] italic text-muted-foreground">
                              Chưa có tóm tắt — chạy phân tích để tạo.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {visibleCount < filteredChapters.length && (
              <div className="p-8 text-center flex flex-col items-center gap-2">
                <LoaderIcon className="w-5 h-5 animate-spin text-primary/50" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Đang tải thêm...</span>
              </div>
            )}
          </div>
        </>
      )}

      <AddChapterDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        novelId={novelId}
        nextOrder={displayedChaptersList.length}
        isAiWritten={activeSubTab === "ai"}
      />

      <BulkAddChaptersDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        novelId={novelId}
        nextOrder={displayedChaptersList.length}
        isAiWritten={activeSubTab === "ai"}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa chương</AlertDialogTitle>
            <AlertDialogDescription>
              Xóa &quot;{deleteTarget?.title}&quot; và toàn bộ nội dung?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TranslateTabPanel
        open={workspaceOpen}
        onOpenChange={setWorkspaceOpen}
        novelId={novelId}
        chapterIds={Array.from(selected)}
        chapters={chapters}
      />

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa hàng loạt</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn chuẩn bị xóa <strong>{selected.size}</strong> chương đã chọn cùng toàn bộ nội dung của chúng. Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleBulkDelete}>
              Xóa {selected.size} chương
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkClearTranslationsOpen} onOpenChange={setBulkClearTranslationsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isEditMode ? "Xóa bản biên tập" : "Xóa bản dịch"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isEditMode
                ? `Bạn chuẩn bị xóa nội dung biên tập của ${selected.size} chương đã chọn và khôi phục về bản gốc. Hành động này không thể hoàn tác.`
                : `Bạn chuẩn bị xóa nội dung dịch của ${selected.size} chương đã chọn và khôi phục về bản gốc. Hành động này không thể hoàn tác.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkClearTranslations}>
              Khôi phục bản gốc
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {translateJob && (translateJob.isRunning || translateJob.step === "progress") && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 shadow-xl border bg-background/95 backdrop-blur p-3 rounded-lg flex items-center gap-4 w-[90%] max-w-sm">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs font-medium mb-1.5">
              <span className="text-primary truncate">
                {isEditMode ? "Biên tập hàng loạt" : "Dịch hàng loạt"} ({translateJob.chaptersCompleted}/{translateJob.totalChapters})
              </span>
              <span>{Math.round((translateJob.chaptersCompleted / Math.max(1, translateJob.totalChapters)) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full ${translateJob.isPaused ? "bg-amber-500" : "bg-primary"} transition-all duration-300`}
                style={{ width: `${Math.round((translateJob.chaptersCompleted / Math.max(1, translateJob.totalChapters)) * 100)}%` }}
              />
            </div>
            {translateJob.currentChapterId && !translateJob.isPaused && (
              <p className="text-[10px] text-muted-foreground mt-1 truncate animate-pulse">
                {isEditMode ? "Đang biên tập chương hiện tại..." : "Đang dịch chương hiện tại..."}
              </p>
            )}
            {translateJob.isPaused && (
              <p className="text-[10px] text-amber-600 mt-1 truncate">
                Đã tạm dừng
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {translateJob.isPaused ? (
              <Button size="icon" variant="outline" className="h-8 w-8 text-primary" onClick={() => useBulkTranslateStore.getState().resume(novelId)} title="Tiếp tục">
                <PlayIcon className="size-4" />
              </Button>
            ) : (
              <Button size="icon" variant="outline" className="h-8 w-8 text-amber-600" onClick={() => useBulkTranslateStore.getState().pause(novelId)} title="Tạm dừng">
                <PauseIcon className="size-4" />
              </Button>
            )}
            <Button size="icon" variant="outline" className="h-8 w-8 text-destructive" onClick={() => useBulkTranslateStore.getState().cancel(novelId)} title={isEditMode ? "Hủy biên tập" : "Hủy dịch"}>
              <XCircleIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
