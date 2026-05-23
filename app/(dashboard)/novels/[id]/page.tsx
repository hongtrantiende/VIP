"use client";

import { AnalysisDialog } from "@/components/analysis-dialog";
import { EditNovelDialog } from "@/components/edit-novel-dialog";
import { PdfTranslateDialog } from "@/components/novel/pdf-translate-dialog";
import { HybridConverterDialog } from "@/components/novel/hybrid-converter-dialog";
import { BulkTranslateDialog } from "@/components/bulk-translate-dialog";
import { BulkReplaceDialog } from "@/components/novel/bulk-replace-dialog";
import { BulkResplitDialog } from "@/components/novel/bulk-resplit-dialog";
import { SplitChapterDialog } from "@/components/novel/split-chapter-dialog";
import { MergeChaptersDialog } from "@/components/novel/merge-chapters-dialog";
import { MergePartsDialog } from "@/components/novel/merge-parts-dialog";
import { ChaptersTab } from "@/components/novel/chapters-tab";
import { EditableText } from "@/components/novel/editable-text";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteNovel,
  updateNovel,
  useNovelDetailStats,
  useChapters,
  useCharacters,
  useNovel,
} from "@/lib/hooks";
import { useProfile } from "@/lib/hooks/use-profile";
import { useScraperQueueStore } from "@/lib/stores/scraper-queue";
import { db } from "@/lib/db";
import { generateEpub } from "@/lib/epub-generator";
import { useApiInferenceProviders, useAIModels } from "@/lib/hooks/use-ai-providers";
import { generateText } from "ai";
import { resolveStep } from "@/lib/ai/resolve-step";
import { downloadNovelJson, downloadNovelChaptersZip, exportNovel, downloadNovelTxt } from "@/lib/novel-io";
import {
  DownloadIcon,
  ExternalLinkIcon,
  PencilIcon,
  ScrollTextIcon,
  Trash2Icon,
  FileArchiveIcon,
  BookOpenIcon,
  LanguagesIcon,
  BookDownIcon,
  LoaderIcon,
} from "lucide-react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useMemo, useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

type AnalysisMode = "full" | "incremental" | "selected";

export default function NovelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState("chapters");
  const { isAdmin } = useProfile();
  const novel = useNovel(id);
  const chapters = useChapters(id);
  const { chapterWordCounts, chapterOriginalWordCounts, analysisStatuses, translatedChapterIds } = useNovelDetailStats(id);
  const totalWords = useMemo(() => {
    let sum = 0;
    chapterWordCounts.forEach((count) => { sum += count; });
    return sum;
  }, [chapterWordCounts]);
  const characters = useCharacters(id);
  const pendingChaptersCount = useScraperQueueStore(s => s.jobs[id]?.chaptersToScrape.length || 0);

  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("full");
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [translateChapterIds, setTranslateChapterIds] = useState<string[]>([]);
  const [pdfTranslateOpen, setPdfTranslateOpen] = useState(false);
  const [pdfTranslateChapterIds, setPdfTranslateChapterIds] = useState<string[]>([]);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceChapterIds, setReplaceChapterIds] = useState<string[]>([]);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertChapterIds, setConvertChapterIds] = useState<string[]>([]);
  const [resplitOpen, setResplitOpen] = useState(false);
  const [resplitChapterIds, setResplitChapterIds] = useState<string[]>([]);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitChapterIds, setSplitChapterIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeChapterIds, setMergeChapterIds] = useState<string[]>([]);
  const [mergePartsOpen, setMergePartsOpen] = useState(false);
  const [mergePartsChapterIds, setMergePartsChapterIds] = useState<string[]>([]);

  const [translateTitleOpen, setTranslateTitleOpen] = useState(false);
  const providers = useApiInferenceProviders();
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isTranslatingTitle, setIsTranslatingTitle] = useState(false);
  const models = useAIModels(selectedProvider);

  useEffect(() => {
    if (providers && providers.length > 0 && !selectedProvider) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers, selectedProvider]);

  useEffect(() => {
    if (models && models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].id);
    }
  }, [models, selectedModel]);

  // Removed old useMemo word counts since they are now queried directly.

  const handleAnalyze = (mode: AnalysisMode, chapterIds?: string[]) => {
    setAnalysisMode(mode);
    setSelectedChapterIds(chapterIds ?? []);
    setAnalysisOpen(true);
  };

  const handleTranslate = (chapterIds: string[]) => {
    setTranslateChapterIds(chapterIds);
    setTranslateOpen(true);
  };

  const handleReplace = (chapterIds: string[]) => {
    setReplaceChapterIds(chapterIds);
    setReplaceOpen(true);
  };

  const handleConvert = (chapterIds: string[]) => {
    setConvertChapterIds(chapterIds);
    setConvertOpen(true);
  };

  const handlePdfTranslate = (chapterIds: string[]) => {
    setPdfTranslateChapterIds(chapterIds);
    setPdfTranslateOpen(true);
  };

  const handleResplit = (chapterIds: string[]) => {
    setResplitChapterIds(chapterIds);
    setResplitOpen(true);
  };

  const handleSplitMultiple = (chapterIds: string[]) => {
    setSplitChapterIds(chapterIds);
    setSplitOpen(true);
  };

  const handleMergeMultiple = (chapterIds: string[]) => {
    setMergeChapterIds(chapterIds);
    setMergeOpen(true);
  };

  const handleMergeParts = (chapterIds: string[]) => {
    setMergePartsChapterIds(chapterIds);
    setMergePartsOpen(true);
  };

  const handleExportEpub = useCallback(async () => {
    if (!novel) return;
    try {
      toast.info("Đang tạo file EPUB, vui lòng đợi...");
      const dbChapters = await db.chapters.where("novelId").equals(novel.id).sortBy("order");

      if (!dbChapters || dbChapters.length === 0) {
        throw new Error("Không có chương nào để xuất!");
      }

      let coverBase64 = null;
      if (novel.coverImage) {
        try {
          const imgRes = await fetch(novel.coverImage);
          const blob = await imgRes.blob();
          coverBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch {
          // Ignore cover fetch error
        }
      }

      const scenes = await db.scenes.where("[novelId+isActive]").equals([novel.id, 1]).toArray();
      const chaptersWithContent = dbChapters.map(ch => {
        const chScenes = scenes.filter(s => s.chapterId === ch.id).sort((a, b) => a.order - b.order);
        const content = chScenes.map(s => s.content).join("\n\n");
        return {
          title: ch.title,
          content: content || "Nội dung chương trống."
        };
      });

      const blob = await generateEpub(novel.title, novel.author || "Unknown", coverBase64 as string | null, chaptersWithContent);

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${novel.title}.epub`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Xuất EPUB thành công!");
    } catch (e: any) {
      toast.error(e.message || "Lỗi khi xuất EPUB");
    }
  }, [novel]);

  const handleTranslateTitle = async () => {
    if (!novel || !selectedProvider || !selectedModel) return;

    try {
      setIsTranslatingTitle(true);

      const model = await resolveStep({ providerId: selectedProvider, modelId: selectedModel });
      if (!model) throw new Error("Không thể tải model AI");

      const sysMsgTitle = "Bạn là biên dịch viên truyện chữ chuyên nghiệp. Chỉ trả về kết quả dịch tiếng Việt của tên truyện, không thêm bất kỳ câu chữ nào khác, không dùng ngoặc kép.";
      const usrMsgTitle = `Dịch tên truyện này sang tiếng Việt: ${novel.title}`;

      const titlePromise = generateText({
        model,
        system: sysMsgTitle,
        prompt: usrMsgTitle,
      });

      let descPromise = Promise.resolve({ text: "" });
      if (novel.description) {
        const sysMsgDesc = "Bạn là biên dịch viên truyện chữ chuyên nghiệp. Dịch đoạn tóm tắt truyện sau sang tiếng Việt chuyên nghiệp, đúng ngữ cảnh kiếm hiệp/tiên hiệp/đô thị. Chỉ trả về bản dịch, không thêm giải thích.";
        const usrMsgDesc = `Dịch mô tả truyện này sang tiếng Việt:\n\n${novel.description}`;
        descPromise = generateText({
          model,
          system: sysMsgDesc,
          prompt: usrMsgDesc,
        });
      }

      toast.info("Đang xử lý dịch thuật...");
      const [titleRes, descRes] = await Promise.all([titlePromise, descPromise]);

      const translatedTitle = titleRes.text.trim();
      const translatedDesc = descRes.text.trim();

      if (!translatedTitle) throw new Error("Không nhận được kết quả dịch tên truyện");

      const updateData: any = { title: translatedTitle };
      if (translatedDesc) updateData.description = translatedDesc;

      await db.novels.update(novel.id, updateData);
      toast.success("Đã dịch tên truyện và mô tả thành công!");
      setTranslateTitleOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Không thể dịch tên truyện");
    } finally {
      setIsTranslatingTitle(false);
    }
  };

  const handleExport = async () => {
    if (!novel) return;
    try {
      const data = await exportNovel(novel.id);
      downloadNovelJson(data);
      toast.success(`Đã xuất "${novel.title}"`);
    } catch {
      toast.error("Xuất tiểu thuyết thất bại");
    }
  };

  const handleExportZip = async (mode: "translated" | "original" = "translated") => {
    if (!novel) return;
    try {
      await downloadNovelChaptersZip(novel.id, mode);
      toast.success(`Đã xuất ZIP ${mode === "original" ? "Bản Gốc" : ""} "${novel.title}"`);
    } catch {
      toast.error("Xuất ZIP thất bại");
    }
  };

  const handleExportTxt = async (mode: "translated" | "original" = "translated") => {
    if (!novel) return;
    try {
      await downloadNovelTxt(novel.id, mode);
      toast.success(`Đã xuất TXT gộp ${mode === "original" ? "Bản Gốc" : ""} "${novel.title}"`);
    } catch {
      toast.error("Xuất TXT thất bại");
    }
  };

  const handleDelete = async () => {
    if (!novel) return;
    try {
      await deleteNovel(novel.id);
      toast.success(`Đã xóa "${novel.title}"`);
      router.push("/library");
    } catch {
      toast.error("Xóa tiểu thuyết thất bại");
    }
  };

  // Loading
  if (novel === undefined) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <Skeleton className="mb-2 h-8 w-64" />
        <Skeleton className="mb-4 h-4 w-96" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (!novel) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <p className="text-muted-foreground">Không tìm thấy tiểu thuyết.</p>
      </main>
    );
  }

  const needsAnalysisCount =
    analysisStatuses?.filter((s) => s.status !== "analyzed").length ?? 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex gap-5 items-start">
        {/* Cover image */}
        {novel.coverImage && (
          <div className="relative w-28 shrink-0 sm:w-36">
            <div className="aspect-3/4 overflow-hidden rounded-lg shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={novel.coverImage}
                alt={novel.title}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </div>
            {novel.color && (
              <div
                className="absolute inset-x-0 bottom-0 h-1 rounded-b-lg"
                style={{ backgroundColor: novel.color }}
              />
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                {!novel.coverImage && novel.color && (
                  <div
                    className="mt-1 size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: novel.color }}
                  />
                )}
                <h1 className="font-heading text-3xl font-bold tracking-tight">
                  {novel.title}
                </h1>
              </div>

              {/* Meta line */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {novel.author && <span>{novel.author}</span>}
                {novel.sourceUrl && novel.author && (
                  <span className="text-muted-foreground/40">·</span>
                )}
                {novel.sourceUrl && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <a
                      href={novel.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Truyện gốc
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  </>
                )}
              </div>

              {novel.description && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {novel.description}
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setTranslateTitleOpen(true)}
                  >
                    <LanguagesIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Dịch tên truyện</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditOpen(true)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Chỉnh sửa</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <FileArchiveIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Xuất ZIP (TXT)</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Tải xuống ZIP</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExportZip("translated")}>
                    <LanguagesIcon className="mr-2 size-4" />
                    Bản dịch AI
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExportZip("original")}>
                    <BookOpenIcon className="mr-2 size-4" />
                    Văn bản gốc
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <ScrollTextIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Xuất TXT (Gộp)</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Tải xuống TXT</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExportTxt("translated")}>
                    <LanguagesIcon className="mr-2 size-4" />
                    Bản dịch AI
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExportTxt("original")}>
                    <BookOpenIcon className="mr-2 size-4" />
                    Văn bản gốc
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleExportEpub}>
                    <BookDownIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Xuất EPUB</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleExport}>
                    <DownloadIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Xuất JSON</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Xóa</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Synopsis */}
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Tóm tắt
            </p>
            <EditableText
              value={novel.synopsis ?? ""}
              onSave={(v) => updateNovel(novel.id, { synopsis: v })}
              placeholder="Chưa có tóm tắt. Chạy phân tích hoặc nhấn để viết..."
              multiline
              displayClassName="text-sm leading-relaxed"
            />
          </div>

          {/* Stats + Genres + Tags */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{chapters?.length ?? 0} đã tải</Badge>
            {pendingChaptersCount > 0 && (
              <Badge variant="outline" className="text-muted-foreground opacity-70 bg-muted/50">{pendingChaptersCount} chờ tải</Badge>
            )}
            <Badge variant="outline">{totalWords.toLocaleString()} từ</Badge>
            {novel.genres?.map((g: string) => (
              <Badge key={g} variant="default">
                {g}
              </Badge>
            ))}
            {novel.tags?.map((t: string) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList className="w-full justify-center gap-1 p-1">
          <TabsTrigger
            value="chapters"
            className="gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3"
          >
            <ScrollTextIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden sm:inline">Chương</span>
            {chapters && chapters.length > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                {chapters.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>



        <TabsContent value="chapters" className="mt-4">
          <ChaptersTab
            novelId={id}
            chapters={chapters ?? []}
            analysisStatuses={analysisStatuses}
            wordCounts={chapterWordCounts}
            originalWordCounts={chapterOriginalWordCounts}
            translatedChapterIds={translatedChapterIds}
            onAnalyze={handleAnalyze}
            onTranslate={handleTranslate}
            onReplace={handleReplace}
            onConvert={handleConvert}
            onPdfTranslate={handlePdfTranslate}
            onResplit={handleResplit}
            onSplitMultiple={handleSplitMultiple}
            onMergeMultiple={handleMergeMultiple}
            onMergeParts={handleMergeParts}
          />
        </TabsContent>
      </Tabs>

      {/* Bulk AI translate dialog */}
      <BulkTranslateDialog
        open={translateOpen}
        onOpenChange={setTranslateOpen}
        novelId={id}
        selectedChapterIds={translateChapterIds}
        chapters={chapters ?? []}
      />

      {/* Hybrid Converter AI dialog */}
      <HybridConverterDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        novelId={id}
        chapterIds={convertChapterIds}
        chapters={chapters ?? []}
      />

      {/* Pdf Translate dialog */}
      <PdfTranslateDialog
        open={pdfTranslateOpen}
        onOpenChange={setPdfTranslateOpen}
        novelId={id}
        chapterIds={pdfTranslateChapterIds}
        chapters={chapters ?? []}
      />

      {/* Bulk resplit dialog */}
      <BulkResplitDialog
        open={resplitOpen}
        onOpenChange={setResplitOpen}
        novelId={id}
        chapterIds={resplitChapterIds}
        chapters={chapters ?? []}
      />

      {/* Split chapter dialog */}
      <SplitChapterDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        novelId={id}
        chapterIds={splitChapterIds}
        chapters={chapters ?? []}
      />

      {/* Merge chapters dialog */}
      <MergeChaptersDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        novelId={id}
        chapterIds={mergeChapterIds}
        chapters={chapters ?? []}
      />

      {/* Merge parts dialog */}
      <MergePartsDialog
        open={mergePartsOpen}
        onOpenChange={setMergePartsOpen}
        novelId={id}
        chapterIds={mergePartsChapterIds}
        chapters={chapters ?? []}
      />

      {/* Bulk replace dialog */}
      <BulkReplaceDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        novelId={id}
        chapterIds={replaceChapterIds}
        chapters={chapters ?? []}
      />

      {/* Analysis dialog */}
      <AnalysisDialog
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
        novelId={id}
        mode={analysisMode}
        selectedChapterIds={
          analysisMode === "selected" ? selectedChapterIds : undefined
        }
        incrementalChaptersCount={needsAnalysisCount}
        totalChapters={chapters?.length ?? 0}
      />

      {/* Edit dialog */}
      <EditNovelDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        novel={novel}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa tiểu thuyết?</AlertDialogTitle>
            <AlertDialogDescription>
              Tiểu thuyết <strong>&ldquo;{novel.title}&rdquo;</strong> cùng toàn
              bộ chương, cảnh, nhân vật và ghi chú sẽ bị xóa vĩnh viễn.
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
      {/* Translate Title Dialog */}
      <Dialog open={translateTitleOpen} onOpenChange={setTranslateTitleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dịch tên truyện</DialogTitle>
            <DialogDescription>
              Tên gốc: <strong className="text-foreground">{novel.title}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nhà cung cấp (Provider)</label>
              <Select value={selectedProvider} onValueChange={setSelectedProvider} disabled={isTranslatingTitle}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn Provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Mô hình AI (Model)</label>
              <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isTranslatingTitle || !models || models.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={models?.length ? "Chọn Model" : "Đang tải..."} />
                </SelectTrigger>
                <SelectContent>
                  {models?.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTranslateTitleOpen(false)} disabled={isTranslatingTitle}>Hủy</Button>
            <Button onClick={handleTranslateTitle} disabled={isTranslatingTitle || !selectedModel}>
              {isTranslatingTitle ? <LoaderIcon className="w-4 h-4 mr-2 animate-spin" /> : <LanguagesIcon className="w-4 h-4 mr-2" />}
              Dịch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
