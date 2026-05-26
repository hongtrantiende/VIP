"use client";

import { ChapterSelectDialog } from "@/components/reader/chapter-select-dialog";
import { SentenceRenderer } from "@/components/reader/sentence-renderer";
import { ObfuscatedText } from "@/components/reader/obfuscated-text";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChapters, useNovel, useOriginalScenes, useScenes } from "@/lib/hooks";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useReaderPanel } from "@/lib/stores/reader-panel";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  BookOpenIcon,
  LanguagesIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function ChapterContent({
  chapterId,
  readerOpen,
  chapterHeader,
  fontSize,
  fontFamily,
}: {
  chapterId: string;
  readerOpen: boolean;
  chapterHeader?: string;
  fontSize: number;
  fontFamily: string;
}) {
  const scenes = useScenes(chapterId);
  const originalScenes = useOriginalScenes(chapterId);
  const [activeTab, setActiveTab] = useState<"translated" | "original">("translated");

  if (!scenes || !originalScenes) return <Skeleton className="h-64 w-full" />;

  const translatedText = scenes.map((s) => s.content).join("\n\n");
  const originalText = originalScenes.map((s) => s.content).join("\n\n");

  const hasTranslation = translatedText !== originalText;

  const renderText = (text: string) => {
    if (!text) {
      return (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap dark:prose-invert">
          <p className="italic text-muted-foreground">
            Chương này chưa có nội dung.
          </p>
        </div>
      );
    }

    if (readerOpen) {
      const ttsContent = chapterHeader ? `${chapterHeader}\n\n${text}` : text;
      return (
        <div className={`prose prose-sm max-w-none dark:prose-invert ${fontFamily.startsWith('!') ? '' : fontFamily}`} style={fontFamily.startsWith('!') ? { fontFamily: fontFamily.replace("!font-[", "").replace("]", "").replace(/_/g, " ").replace(/'/g, "") } : {}}>
          <SentenceRenderer content={ttsContent} />
        </div>
      );
    }

    return (
      <div
        className={`prose prose-stone max-w-none dark:prose-invert whitespace-pre-wrap leading-relaxed md:leading-loose tracking-wide px-2 md:px-4 ${fontFamily.startsWith('!') ? '' : fontFamily}`}
        style={{ fontSize: `${fontSize}px`, ...(fontFamily.startsWith('!') ? { fontFamily: fontFamily.replace("!font-[", "").replace("]", "").replace(/_/g, " ").replace(/'/g, "") } : {}) }}
      >
        {text.split(/\r?\n/).map(p => p.trim()).filter(Boolean).map((paragraph, i) => (
          <p key={i} className="mb-6 last:mb-0">
            <ObfuscatedText text={paragraph} />
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {hasTranslation && (
        <div className="flex justify-center">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-auto">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="translated" className="gap-2 text-xs">
                <LanguagesIcon className="size-3.5" />
                Bản dịch
              </TabsTrigger>
              <TabsTrigger value="original" className="gap-2 text-xs">
                <BookOpenIcon className="size-3.5" />
                Văn bản gốc
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="relative">
        {activeTab === "translated" ? renderText(translatedText) : renderText(originalText)}
      </div>
    </div>
  );
}

export default function ReadingView() {
  const { id, order } = useParams<{ id: string; order: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const isAi = mode === "ai";

  const novel = useNovel(id);
  const chapters = useChapters(id, isAi);
  const isReaderOpen = useReaderPanel((s) => s.isOpen);

  const [fontSize, setFontSize] = useState(20);
  const [fontFamily, setFontFamily] = useState("font-serif");

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSize = localStorage.getItem("reader_font_size");
    const savedFamily = localStorage.getItem("reader_font_family");
    if (savedSize) setFontSize(parseInt(savedSize));
    if (savedFamily) {
      if (savedFamily.includes("Palatino")) {
        setFontFamily("font-palatino");
      } else if (savedFamily.includes("Times_New_Roman")) {
        setFontFamily("font-times");
      } else if (savedFamily.includes("Arial")) {
        setFontFamily("font-sans");
      } else {
        setFontFamily(savedFamily);
      }
    }
  }, []);

  const updateFontSize = (newSize: number) => {
    const val = Math.max(14, Math.min(32, newSize));
    setFontSize(val);
    localStorage.setItem("reader_font_size", val.toString());
  };

  const updateFontFamily = (newFamily: string) => {
    setFontFamily(newFamily);
    localStorage.setItem("reader_font_family", newFamily);
  };

  // order is 1-based in the URL → convert to 0-based index
  const orderNum = parseInt(order, 10);
  const requestedIndex = isNaN(orderNum) || orderNum < 1 ? 0 : orderNum - 1;
  const clampedIndex = chapters
    ? Math.min(requestedIndex, Math.max(0, chapters.length - 1))
    : requestedIndex;

  const chapter = chapters?.[clampedIndex];
  const hasPrev = clampedIndex > 0;
  const hasNext = chapters ? clampedIndex < chapters.length - 1 : false;

  const navigateTo = (index: number) => {
    router.push(`/novels/${id}/read/${index + 1}${isAi ? "?mode=ai" : ""}`);
  };

  // Redirect to valid order if out of range
  useEffect(() => {
    if (!chapters || chapters.length === 0) return;
    if (isNaN(orderNum) || clampedIndex !== requestedIndex) {
      router.replace(`/novels/${id}/read/${clampedIndex + 1}${isAi ? "?mode=ai" : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters?.length, clampedIndex, requestedIndex, orderNum, id, router, isAi]);

  // Sync store whenever the chapter changes (URL is source of truth here)
  useEffect(() => {
    if (!novel || !chapters || chapters.length === 0) return;
    useReaderPanel.getState().setNovelContext({
      novelId: id,
      novelTitle: novel.title,
      totalChapters: chapters.length,
      chapterIndex: clampedIndex,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, novel?.title, chapters?.length, clampedIndex]);

  // Keep chapter title in sync
  useEffect(() => {
    if (chapter?.title) {
      useReaderPanel.getState().setChapterTitle(chapter.title);
    }
  }, [chapter?.title]);

  useMediaSession({
    novelTitle: novel?.title ?? "",
    chapterTitle: chapter?.title ?? "",
    chapterNumber: clampedIndex + 1,
    hasPrev,
    hasNext,
    onPrev: () => useReaderPanel.getState().prevChapter(),
    onNext: () => useReaderPanel.getState().nextChapter(),
  });

  if (novel === undefined || !chapters) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (!novel) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <p className="text-muted-foreground">Không tìm thấy tiểu thuyết.</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col min-h-screen">
      {/* Header - Sticky Style */}
      <div className="sticky top-0 z-50 flex shrink-0 items-center justify-between gap-3 bg-background/95 px-6 py-3 backdrop-blur-md border-b shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={`/novels/${id}`}>
              <ArrowLeftIcon className="size-4" />
            </Link>
          </Button>
          <span className="text-sm font-semibold text-muted-foreground truncate hidden sm:inline">
            {novel.title}
          </span>
          {chapter && (
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              title="Chỉnh sửa chương"
            >
              <Link href={`/novels/${id}/chapters/${chapter.id}`}>
                <PencilIcon className="size-4" />
              </Link>
            </Button>
          )}
          <ChapterSelectDialog
            chapters={chapters}
            currentIndex={clampedIndex}
            onSelect={navigateTo}
          />
        </div>

        <div className="flex items-center gap-3">
          <Select value={fontFamily} onValueChange={updateFontFamily}>
            <SelectTrigger className="h-8 w-[130px] sm:w-[150px] bg-transparent">
              <SelectValue placeholder="Font" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="font-serif">Serif (Playfair)</SelectItem>
              <SelectItem value="font-bookerly">Bookerly</SelectItem>
              <SelectItem value="font-literata">Literata</SelectItem>
              <SelectItem value="font-lora">Lora</SelectItem>
              <SelectItem value="font-palatino">Palatino</SelectItem>
              <SelectItem value="font-times">Times New Roman</SelectItem>
              <SelectItem value="font-sans">Sans-serif</SelectItem>
              <SelectItem value="font-mono">Monospace</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-1 items-center bg-muted/30 p-0.5 rounded-md border">
            <Button variant="ghost" size="icon-xs" className="h-7 w-7" onClick={() => updateFontSize(fontSize - 2)}>A-</Button>
            <span className="text-[10px] font-bold w-5 text-center tabular-nums">{fontSize}</span>
            <Button variant="ghost" size="icon-xs" className="h-7 w-7" onClick={() => updateFontSize(fontSize + 2)}>A+</Button>
          </div>
        </div>
      </div>

      {/* Chapter content */}
      {chapter && (
        <div className="flex-1 px-6">
          <div className="mx-auto max-w-3xl pb-12 pt-8">
            <h2 className="mb-10 text-center font-heading text-3xl font-bold leading-tight">
              {chapter.title}
            </h2>
            <ChapterContent
              chapterId={chapter.id}
              readerOpen={isReaderOpen}
              chapterHeader={`Chương ${clampedIndex + 1}: ${chapter.title}`}
              fontSize={fontSize}
              fontFamily={fontFamily}
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="sticky bottom-0 z-40 flex shrink-0 items-center justify-between border-t bg-background/95 backdrop-blur-md px-6 py-3 mt-auto">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrev}
          onClick={() => navigateTo(clampedIndex - 1)}
        >
          <ChevronLeftIcon className="mr-1 size-4" />
          Trước
        </Button>
        <span className="text-xs text-muted-foreground">
          {clampedIndex + 1} / {chapters.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onClick={() => navigateTo(clampedIndex + 1)}
        >
          Tiếp
          <ChevronRightIcon className="ml-1 size-4" />
        </Button>
      </div>
    </main>
  );
}
