"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ScraperOverlay } from "@/components/scraper/scraper-overlay";
import { useScraperQueueStore } from "@/lib/stores/scraper-queue";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { useNovels } from "@/lib/hooks";
import { getAdapters } from "@/lib/scraper/adapters";
import {
  getExtensionId,
  getScrapeTimeout,
  setExtensionId,
  setScrapeTimeout,
} from "@/lib/scraper/extension-bridge";
import { findNovelBySourceUrl } from "@/lib/scraper/source-url-match";
import type { ChapterContent, ChapterLink } from "@/lib/scraper/types";
import { type ScraperStep, useScraperStore } from "@/lib/stores/scraper";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BookPlusIcon,
  CheckIcon,
  CircleDotIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  EyeIcon,
  GlobeIcon,
  HandIcon,
  LibraryIcon,
  Link2Icon,
  ListChecksIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type User } from "@supabase/supabase-js";
import { PasswordGate } from "@/components/password-gate";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn, countWords, stripHtml, isLocalhost } from "@/lib/utils";



const REQUIRED_EXTENSION_VERSION: string =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@/extension/manifest.json").version;

function isVersionOutdated(current: string | null, required: string): boolean {
  if (!current) return false; // can't tell → don't warn
  const parse = (v: string) => v.split(".").map(Number);
  const [ca, cb, cc] = parse(current);
  const [ra, rb, rc] = parse(required);
  if (ca !== ra) return ca < ra;
  if (cb !== rb) return cb < rb;
  return cc < rc;
}

// ─── Steps ─────────────────────────────────────────────────

const STEPS: { key: ScraperStep; label: string; icon: React.ElementType }[] = [
  { key: "url", label: "URL", icon: GlobeIcon },
  { key: "select", label: "Chọn chương", icon: ListChecksIcon },
  { key: "stv-wait", label: "Chuẩn bị", icon: HandIcon },
  { key: "scraping", label: "Scraping", icon: LoaderIcon },
  { key: "preview", label: "Xem trước", icon: EyeIcon },
];

const SCRAPER_SELECT_ROW_H = 40;
const SCRAPER_SCRAPING_ROW_H = 36;

function VirtualScraperChapterPicker({
  chapters,
  selectedChapterUrls,
  toggleChapter,
}: {
  chapters: ChapterLink[];
  selectedChapterUrls: Set<string>;
  toggleChapter: (url: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter(
      (ch) =>
        ch.title.toLowerCase().includes(q) ||
        `${ch.order + 1}`.includes(q),
    );
  }, [chapters, search]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => SCRAPER_SELECT_ROW_H,
    overscan: 16,
    getItemKey: (index) => filtered[index]?.url ?? index,
  });

  return (
    <div className="space-y-2">
      {chapters.length >= 60 && (
        <Input
          placeholder="Tìm chương (tiêu đề hoặc số thứ tự)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
      )}
      <div
        ref={parentRef}
        className="h-[340px] overflow-y-auto overscroll-contain rounded-md border"
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {chapters.length === 0
              ? "Không có chương"
              : "Không có chương khớp tìm kiếm"}
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const ch = filtered[vi.index];
              return (
                <div
                  key={ch.url}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <label className="flex h-full cursor-pointer items-center gap-3 px-3 py-1.5 transition-colors hover:bg-muted/60">
                    <Checkbox
                      checked={selectedChapterUrls.has(ch.url)}
                      onCheckedChange={() => toggleChapter(ch.url)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {ch.title}
                    </span>
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/50">
                      {ch.order + 1}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function VirtualScrapingChapterRows({ chapters }: { chapters: ChapterContent[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: chapters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => SCRAPER_SCRAPING_ROW_H,
    overscan: 20,
    getItemKey: (index) => index,
  });

  return (
    <div
      ref={parentRef}
      className="h-[240px] overflow-y-auto overscroll-contain rounded-md border"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const ch = chapters[vi.index];
          return (
            <div
              key={vi.key}
              className="absolute top-0 left-0 w-full"
              style={{
                height: vi.size,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <div
                className={`flex h-full items-center gap-2 px-2.5 py-1.5 text-xs ${
                  ch.warning ? "bg-amber-50/50 dark:bg-amber-950/10" : ""
                }`}
              >
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground/40">
                  {vi.index + 1}
                </span>
                {ch.warning ? (
                  <AlertTriangleIcon className="size-3 shrink-0 text-amber-500" />
                ) : (
                  <CheckIcon className="size-3 shrink-0 text-green-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {ch.title}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground/40">
                  {ch.content.length.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VirtualPreviewChapterRows({
  chapters,
  retryingIndex,
  onRetry,
}: {
  chapters: ChapterContent[];
  retryingIndex: number | null;
  onRetry: (index: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: chapters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => index,
  });

  return (
    <div
      ref={parentRef}
      className="h-[280px] overflow-y-auto overscroll-contain rounded-md border"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const ch = chapters[vi.index];
          const plainText = stripHtml(ch.content);
          const words = countWords(plainText);
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full px-2.5 py-2"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <div
                className={`rounded-md transition-colors hover:bg-muted/40 ${
                  ch.warning ? "bg-amber-50/50 dark:bg-amber-950/10" : ""
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-px w-6 shrink-0 text-right tabular-nums text-[10px] text-muted-foreground/40">
                    {vi.index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug font-medium">
                      {ch.title}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {plainText.slice(0, 120)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/50">
                        {words.toLocaleString()} từ
                      </span>
                      {ch.warning && (
                        <>
                          <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                            <AlertTriangleIcon className="size-2.5" />
                            Nội dung ngắn
                          </span>
                          {retryingIndex === vi.index ? (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <LoaderIcon className="size-2.5 animate-spin" />
                              Đang thử lại...
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onRetry(vi.index)}
                              disabled={retryingIndex !== null}
                              className="flex items-center gap-0.5 text-[10px] text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                            >
                              <RefreshCwIcon className="size-2.5" />
                              Thử lại
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────

export default function ScraperPage() {
  const router = useRouter();
  const store = useScraperStore();
  const stepIndex = STEPS.findIndex((s) => s.key === store.step);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    store.checkExtension();
    setAuthLoading(false);
  }, []);

  const isAdmin = true;
  const isVip = true;

  if (authLoading) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-8 flex items-center justify-center">
        <LoaderIcon className="size-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAdmin && !isVip) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-12">
        <Card className="border-dashed border-2">
          <CardHeader className="text-center">
            <div className="mx-auto size-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 mb-4">
              <ShieldCheckIcon className="size-6" />
            </div>
            <CardTitle>Yêu cầu quyền VIP</CardTitle>
            <CardDescription>
              Tính năng Import Truyện chỉ dành cho thành viên VIP hoặc Quản trị viên.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Vui lòng liên hệ quản trị viên để nâng cấp tài khoản của bạn lên VIP để sử dụng tính năng này.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => router.push("/dashboard")}>Quay lại</Button>
              <Button 
                onClick={async () => {
                  setAuthLoading(true);
                  const { data, error } = await supabase!.auth.refreshSession();
                  if (error) {
                    toast.error("Không thể làm mới phiên đăng nhập: " + error.message);
                  } else {
                    setUser(data.session?.user ?? null);
                    toast.success("Đã làm mới quyền truy cập!");
                  }
                  setAuthLoading(false);
                }}
              >
                Làm mới quyền
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            Scraper
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nhập truyện từ website bên ngoài vào hệ thống.
          </p>
        </div>
        <DebugToolbar />
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Step indicator */}
        <nav className="flex items-center justify-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && (
                <ArrowRightIcon
                  className={`size-3 shrink-0 ${i <= stepIndex ? "text-primary" : "text-border"}`}
                />
              )}
              <button
                onClick={() => {
                  if (i < stepIndex) store.setStep(s.key);
                }}
                disabled={i > stepIndex}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-all sm:px-3 ${
                  i === stepIndex
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : i < stepIndex
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "text-muted-foreground/50"
                }`}
              >
                <s.icon
                  className={`size-3.5 shrink-0 sm:size-3 ${i === stepIndex && s.key === "scraping" ? "animate-spin" : ""}`}
                />
                <span
                  className={i === stepIndex ? "sm:inline" : "hidden sm:inline"}
                >
                  {s.label}
                </span>
              </button>
            </div>
          ))}
        </nav>

        {store.step === "url" && <UrlStep />}
        {store.step === "select" && <SelectStep />}
        {store.step === "stv-wait" && <STVWaitStep />}
        {store.step === "scraping" && <ScrapingStep />}
        {store.step === "preview" && <PreviewStep router={router} />}
      </div>
    </main>
  );
}

// ─── Step 1: URL ───────────────────────────────────────────

function UrlStep() {
  const {
    url,
    setUrl,
    adapter,
    extensionAvailable,
    extensionVersion,
    isLoading,
    error,
    fetchNovelInfo,
    checkExtension,
  } = useScraperStore();

  const [extId, setExtId] = useState(() => getExtensionId());
  const [timeout, setTimeout_] = useState(() => getScrapeTimeout() / 1000);

  const handleSaveExtId = () => {
    setExtensionId(extId);
    checkExtension();
  };

  const handleTimeoutChange = (val: string) => {
    setTimeout_(parseInt(val, 10) || 0);
  };

  const handleTimeoutBlur = () => {
    const clamped = Math.max(5, Math.min(60, timeout || 10));
    setTimeout_(clamped);
    setScrapeTimeout(clamped * 1000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nhập URL truyện</CardTitle>
        <CardDescription>
          Dán URL trang truyện để lấy danh sách chương.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Extension config */}
        <div className="space-y-3">
          {extensionAvailable ? (
            <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-sm">
                <CircleDotIcon className="size-3.5 text-green-500" />
                <span className="text-green-700 dark:text-green-400">
                  Extension đã kết nối (v{extensionVersion})
                </span>
              </div>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => { setExtId(""); setExtensionId(""); checkExtension(); }}>Đổi</Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border p-3 bg-muted/10">
              <div className="space-y-1.5">
                <Label htmlFor="ext-id" className="text-xs font-medium">
                  Extension ID
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="ext-id"
                    placeholder="Paste ID từ chrome://extensions"
                    value={extId}
                    onChange={(e) => setExtId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveExtId();
                    }}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveExtId}
                    disabled={!extId.trim()}
                    className="shrink-0 h-8"
                  >
                    Kết nối
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <ol className="list-inside list-decimal space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  <li>Tải và giải nén extension bản PC bên dưới.</li>
                  <li>Mở <code className="rounded bg-muted px-1 py-0.5 text-[10px]">chrome://extensions</code>, bật <strong>Developer mode</strong>.</li>
                  <li>Chọn <strong>Load unpacked</strong> &rarr; Trỏ tới thư mục vừa giải nén.</li>
                </ol>
                <Button variant="outline" size="sm" className="h-7 w-fit text-xs" asChild>
                  <a href="/novel-studio-connector-pc.zip?v=5.0" download>
                    <DownloadIcon className="mr-1.5 size-3" />
                    Tải Extension v5.0 (.zip)
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* URL + Adapter */}
        <div className="space-y-3">
          <div>
            <Label htmlFor="novel-url">URL trang truyện</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="novel-url"
                placeholder="https://domain.com/truyen/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && adapter && extensionAvailable)
                    fetchNovelInfo();
                }}
              />
              <Button
                onClick={fetchNovelInfo}
                disabled={
                  !url.trim() || !adapter || !extensionAvailable || isLoading
                }
                className="shrink-0"
                variant="outline"
              >
                {isLoading ? (
                  <LoaderIcon className="size-4 animate-spin" />
                ) : (
                  "Lấy thông tin"
                )}
              </Button>
              {adapter?.name === "XTruyen" && (
                <Button
                  onClick={() => useScraperStore.getState().startCrawling()}
                  disabled={
                    !url.trim() || !adapter || !extensionAvailable || isLoading
                  }
                  className="shrink-0"
                >
                  <ArrowRightIcon className="mr-1.5 size-4" />
                  Crawl từ chương này
                </Button>
              )}
            </div>
          </div>

          {/* Quick Access & Instructions */}
          <Tabs defaultValue="list" className="w-full">
            <TabsList className="w-full grid grid-cols-2 h-9">
              <TabsTrigger value="list" className="text-xs">Danh sách Web</TabsTrigger>
              <TabsTrigger value="guides" className="text-xs">Hướng dẫn quét</TabsTrigger>
            </TabsList>
            
            <TabsContent value="list" className="mt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Web Việt */}
                <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 p-3">
                  <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70">Web Việt</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://sangtacviet.com" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-blue-500" />
                        SangTacViet
                      </a>
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://xtruyen.vn" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-orange-500" />
                        XTruyen
                      </a>
                    </Button>
                  </div>
                </div>

                {/* Web Trung */}
                <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 p-3">
                  <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70">Web Trung</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://uukanshu.cc/quanben/" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-red-500" />
                        Uukanshu
                      </a>
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://www.piaotia.com/" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-green-600" />
                        PiaoTian
                      </a>
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://www.69shuba.com/" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-green-700" />
                        69Shu
                      </a>
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://www.jjwxc.net/" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-purple-600" />
                        Jjwxc
                      </a>
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://www.cuoceng.com/" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-indigo-600" />
                        CuoCeng
                      </a>
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 gap-2 text-xs bg-background hover:bg-primary/5 hover:text-primary hover:border-primary/50"
                      asChild
                    >
                      <a href="https://www.69shuba.tw/" target="_blank" rel="noreferrer">
                        <GlobeIcon className="size-3.5 text-emerald-600" />
                        69Shu.TW
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="guides" className="mt-4 space-y-3">
              <div className="rounded-lg border p-4 space-y-4 bg-muted/5">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-orange-600 font-bold text-sm">
                    <GlobeIcon className="size-4" />
                    XTruyen.vn (Khuyên dùng)
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Trang này có cơ chế giấu danh sách chương rất phức tạp. Hãy dùng nút <b>"Crawl từ chương này"</b> sau khi dán link chương 1. App sẽ tự động "bò" theo nút "Chương tiếp" để lấy đủ nội dung mà không sợ bị sót.
                  </p>
                </div>
                
                <div className="h-px bg-border/50" />

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-blue-600 font-bold text-sm">
                    <GlobeIcon className="size-4" />
                    SangTacViet.com
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Yêu cầu phải mở Tab SangTacViet trên trình duyệt. Sau khi nhấn "Quét danh sách", App sẽ hướng dẫn bạn nhấn vào chương đầu tiên ở Tab kia để kích hoạt nạp dữ liệu.
                  </p>
                </div>

                <div className="h-px bg-border/50" />

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-green-600 font-bold text-sm">
                    <GlobeIcon className="size-4" />
                    Web Trung (Uukanshu, Piaotia...)
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Dán link trang chủ truyện và nhấn <b>"Lấy thông tin"</b>. App sẽ tự động lấy toàn bộ danh sách chương.
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Bộ giải mã:</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { group: "vn", label: "Việt Nam" },
                { group: "cn", label: "Trung Quốc" },
              ].map((g) => (
                <div key={g.group} className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground/40 px-1 uppercase tracking-tight">{g.label}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {getAdapters()
                      .filter((a) => (a.group || "cn") === g.group)
                      .map((a) => {
                        const autoDetected = url && a.urlPattern.test(url);
                        const isSelected = adapter?.name === a.name;
                        return (
                          <button
                            key={a.name}
                            onClick={() =>
                              useScraperStore
                                .getState()
                                .setAdapter(isSelected ? null : a)
                            }
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : autoDetected
                                  ? "border-primary/50 bg-primary/10 text-primary"
                                  : "border-dashed border-muted-foreground/30 text-muted-foreground/60 hover:border-muted-foreground/50 hover:text-muted-foreground"
                            }`}
                          >
                            {isSelected && <CheckIcon className="size-2.5" />}
                            {a.name}
                            {autoDetected && !isSelected && (
                              <span className="text-[9px] opacity-60">auto</span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 2: Select ────────────────────────────────────────

function SelectStep() {
  const {
    novelInfo,
    selectedChapterUrls,
    toggleChapter,
    selectAll,
    deselectAll,
    startScraping,
    setStep,
    chapterDelay,
    setChapterDelay,
  } = useScraperStore();

  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  if (!novelInfo) return null;

  const handleSelectRange = () => {
    const from = parseInt(rangeFrom, 10) || 1;
    const to = parseInt(rangeTo, 10) || novelInfo.chapters.length;
    const urls = new Set(
      novelInfo.chapters
        .filter((ch) => ch.order + 1 >= from && ch.order + 1 <= to)
        .map((ch) => ch.url),
    );
    useScraperStore.setState({ selectedChapterUrls: urls });
  };

  const isAllSelected = selectedChapterUrls.size === novelInfo.chapters.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="line-clamp-1">{novelInfo.title}</CardTitle>
        <CardDescription>
          {novelInfo.author && <>{novelInfo.author} · </>}
          {novelInfo.chapters.length} chương ·{" "}
          <span className="font-medium text-foreground">
            {selectedChapterUrls.size}
          </span>{" "}
          đã chọn
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {novelInfo.description && (
          <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
            {novelInfo.description}
          </p>
        )}

        {/* Controls bar */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={isAllSelected ? deselectAll : selectAll}
          >
            {isAllSelected ? (
              <SquareIcon className="mr-1 size-3" />
            ) : (
              <CheckIcon className="mr-1 size-3" />
            )}
            {isAllSelected ? "Bỏ chọn" : "Chọn tất cả"}
          </Button>

          <div className="mx-1 h-4 w-px bg-border" />

          <div className="flex items-center gap-1">
            <Input
              type="number"
              placeholder="Từ"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              className="h-7 w-16 text-xs placeholder:text-xs"
              min={1}
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="number"
              placeholder="Đến"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              className="h-7 w-16 text-xs placeholder:text-xs"
              min={1}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleSelectRange}
            >
              Chọn
            </Button>
          </div>
        </div>

        <VirtualScraperChapterPicker
          chapters={novelInfo.chapters}
          selectedChapterUrls={selectedChapterUrls}
          toggleChapter={toggleChapter}
        />

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={() => setStep("url")}>
            Quay lại
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="delay-select" className="text-xs text-muted-foreground">
                Độ trễ (giây):
              </Label>
              <Input
                id="delay-select"
                type="number"
                min={0}
                max={60}
                value={chapterDelay}
                onChange={(e) => setChapterDelay(Number(e.target.value))}
                className="h-8 w-16 text-center text-xs"
              />
            </div>
            <div className="flex gap-2">
              <BackgroundScrapeDialog />
              <Button
                onClick={startScraping}
                disabled={selectedChapterUrls.size === 0}
              >
                Scrape {selectedChapterUrls.size} chương
                <ArrowRightIcon className="ml-1 size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BackgroundScrapeDialog() {
  const { novelInfo, selectedChapterUrls, url, chapterDelay, reset } = useScraperStore();
  const { addJob } = useScraperQueueStore();
  const novels = useNovels();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [selectedNovelId, setSelectedNovelId] = useState<string>("");
  const [title, setTitle] = useState(novelInfo?.title || "");
  const [desc, setDesc] = useState(novelInfo?.description || "");

  const handleStart = async () => {
    if (mode === "new" && !title.trim()) {
      toast.error("Vui lòng nhập tiêu đề");
      return;
    }
    if (mode === "existing" && !selectedNovelId) {
      toast.error("Vui lòng chọn truyện");
      return;
    }

    let finalNovelId = selectedNovelId;
    
    // Create novel entry if needed
    if (mode === "new") {
      finalNovelId = crypto.randomUUID();
      const now = new Date();
      await db.novels.add({
        id: finalNovelId,
        title: title.trim(),
        description: desc.trim(),
        sourceUrl: url,
        author: novelInfo?.author || "",
        coverImage: novelInfo?.coverImage,
        createdAt: now,
        updatedAt: now,
      });
    }

    const selectedChapters = (novelInfo?.chapters || []).filter(ch => selectedChapterUrls.has(ch.url));
    if (selectedChapters.length === 0) return;

    addJob(finalNovelId, mode === "new" ? title : (novels?.find(n => n.id === finalNovelId)?.title || title), url, selectedChapters, chapterDelay * 1000);
    
    toast.success("Đã thêm vào hàng đợi tải nền!");
    setOpen(false);
    reset(); // Reset UI for the next novel
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={selectedChapterUrls.size === 0}>
          <DownloadIcon className="mr-1.5 size-3.5" />
          Tải nền
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thiết lập tải nền</DialogTitle>
          <DialogDescription>
            Truyện sẽ được tải và lưu trực tiếp vào danh sách. Bạn có thể đọc ngay khi chương mới được tải về.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex rounded-lg bg-muted p-1">
            <button
              onClick={() => setMode("new")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                mode === "new"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <PlusIcon className="size-3.5" />
              Tạo mới
            </button>
            <button
              onClick={() => setMode("existing")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                mode === "existing"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BookPlusIcon className="size-3.5" />
              Thêm vào có sẵn
            </button>
          </div>

          {mode === "new" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Tiêu đề</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mô tả</Label>
                <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} className="max-h-32 overflow-y-auto" />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Chọn truyện</Label>
              <Select value={selectedNovelId} onValueChange={setSelectedNovelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn truyện mục tiêu..." />
                </SelectTrigger>
                <SelectContent>
                  {novels?.map(n => (
                    <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>• {selectedChapterUrls.size} chương sẽ được tải.</p>
            <p>• Mỗi chương tải xong sẽ lưu vào DB ngay lập tức.</p>
            <p>• Có thể tạm dừng/tiếp tục từ thanh thông báo ở góc màn hình.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Hủy</Button>
          <Button onClick={handleStart}>Bắt đầu tải nền</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─── Step 2.5: STV Wait ─────────────────────────────────────

function STVWaitStep() {
  const { novelInfo, selectedChapterUrls, confirmSTVReady, setStep, chapterDelay, setChapterDelay } = useScraperStore();
  if (!novelInfo) return null;

  const firstChapter = novelInfo.chapters.find((ch) => selectedChapterUrls.has(ch.url));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandIcon className="size-5 text-amber-500" />
          Chuẩn bị tải chương
        </CardTitle>
        <CardDescription>
          SangTacViet yêu cầu thao tác bằng tay để tải nội dung.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">1</div>
              <div>
                <p className="font-medium text-sm">Mở tab SangTacViet</p>
                <p className="text-xs text-muted-foreground">
                  Chuyển qua trình duyệt và mở trang SangTacViet
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">2</div>
              <div>
                <p className="font-medium text-sm">Nhấp vào chương đầu tiên</p>
                <p className="text-xs text-muted-foreground">
                  Bấm vào {firstChapter ? `"${firstChapter.title}"` : "chương đầu tiên bạn muốn tải"} để nội dung hiện ra
                </p>
                {firstChapter && (
                  <a
                    href={firstChapter.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <Link2Icon className="size-3" />
                    Mở chương đầu tiên
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">3</div>
              <div>
                <p className="font-medium text-sm">Chờ nội dung load xong</p>
                <p className="text-xs text-muted-foreground">
                  Đảm bảo nội dung chương đã hiện đầy đủ trên trang
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white">4</div>
              <div>
                <p className="font-medium text-sm">Quay lại đây và bấm Tiếp tục</p>
                <p className="text-xs text-muted-foreground">
                  Hệ thống sẽ tự động tải các chương tiếp theo
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setStep("select")}>
            Quay lại
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="delay-stv" className="text-xs text-muted-foreground">
                Độ trễ (giây):
              </Label>
              <Input
                id="delay-stv"
                type="number"
                min={0}
                max={60}
                value={chapterDelay}
                onChange={(e) => setChapterDelay(Number(e.target.value))}
                className="h-8 w-16 text-center text-xs"
              />
            </div>
            <Button onClick={confirmSTVReady}>
              Tôi đã mở chương — Tiếp tục
              <ArrowRightIcon className="ml-1 size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 3: Progress ──────────────────────────────────────

function ScrapingStep() {
  const { progress, isLoading, error, abortScraping, scrapedChapters, adapter } =
    useScraperStore();

  const percent =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const warnCount = scrapedChapters.filter((ch) => ch.warning).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isLoading && <LoaderIcon className="size-4 animate-spin" />}
          Đang scrape
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          <span>
            {progress.completed} / {progress.total} chương
          </span>
          {warnCount > 0 && (
            <Badge
              variant="secondary"
              className="gap-1 border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
            >
              <AlertTriangleIcon className="size-2.5" />
              {warnCount}
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Progress value={percent} className="h-1.5" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate pr-4">{progress.current || "..."}</span>
            <span className="shrink-0 tabular-nums">{percent}%</span>
          </div>
        </div>

        {/* Live chapter results */}
        {scrapedChapters.length > 0 && (
          <VirtualScrapingChapterRows chapters={scrapedChapters} />
        )}

        {error && (
          <div className="space-y-3">
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/20">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
            {scrapedChapters.length > 0 && adapter?.name === "STV" && (
              <div className="flex justify-center">
                <Button 
                  size="sm" 
                  variant="default"
                  onClick={() => useScraperStore.getState().confirmSTVReady()}
                  className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-sm"
                >
                  <RefreshCwIcon className="size-3.5" />
                  Tiếp tục tải các chương còn lại
                </Button>
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={abortScraping}>
              Hủy
            </Button>
          </div>
        ) : (
          <div className="flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => useScraperStore.getState().setStep("select")}
            >
              Quay lại
            </Button>
            {scrapedChapters.length > 0 && (
              <Button
                size="sm"
                onClick={() => useScraperStore.getState().setStep("preview")}
              >
                Xem trước {scrapedChapters.length} chương đã scrape
                <ArrowRightIcon className="ml-1 size-3.5" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Step 4: Preview ───────────────────────────────────────

function PreviewStep({ router }: { router: ReturnType<typeof useRouter> }) {
  const { novelInfo, scrapedChapters, retryingIndex, url, reset } =
    useScraperStore();
  const novels = useNovels();

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [selectedNovelId, setSelectedNovelId] = useState<string>("");
  const [novelTitle, setNovelTitle] = useState(novelInfo?.title ?? "");
  const [novelDescription, setNovelDescription] = useState(
    novelInfo?.description ?? "",
  );
  const [isImporting, setIsImporting] = useState(false);

  const novelMatchedBySourceUrl = useMemo(
    () => findNovelBySourceUrl(novels, url),
    [novels, url],
  );
  const sourceUrlLinkAppliedRef = useRef(false);

  useEffect(() => {
    sourceUrlLinkAppliedRef.current = false;
  }, [url]);

  useEffect(() => {
    if (sourceUrlLinkAppliedRef.current) return;
    if (!novelMatchedBySourceUrl) return;
    setMode("existing");
    setSelectedNovelId(novelMatchedBySourceUrl.id);
    sourceUrlLinkAppliedRef.current = true;
  }, [novelMatchedBySourceUrl]);

  const [showOnlyWarnings, setShowOnlyWarnings] = useState(false);
  const totalWords = scrapedChapters.reduce(
    (sum, ch) => sum + countWords(stripHtml(ch.content)),
    0,
  );
  const warnCount = scrapedChapters.filter((ch) => ch.warning).length;
  
  const displayedChapters = useMemo(() => {
    if (!showOnlyWarnings) return scrapedChapters;
    return scrapedChapters.filter(ch => ch.warning);
  }, [scrapedChapters, showOnlyWarnings]);

  const handleImport = async () => {
    if (mode === "new" && !novelTitle.trim()) {
      toast.error("Vui lòng nhập tiêu đề tiểu thuyết");
      return;
    }
    if (mode === "existing" && !selectedNovelId) {
      toast.error("Vui lòng chọn truyện");
      return;
    }

    setIsImporting(true);
    try {
      const now = new Date();

      if (mode === "new") {
        const novelId = crypto.randomUUID();
        await db.transaction(
          "rw",
          [db.novels, db.chapters, db.scenes],
          async () => {
            await db.novels.add({
              id: novelId,
              title: novelTitle.trim(),
              description: novelDescription.trim(),
              sourceUrl: url,
              author: novelInfo?.author,
              ...(novelInfo?.coverImage
                ? { coverImage: novelInfo.coverImage }
                : {}),
              createdAt: now,
              updatedAt: now,
            });
            await insertChapters(novelId, 0, now);
          },
        );
        toast.success(
          `Đã tạo "${novelTitle}" với ${scrapedChapters.length} chương`,
        );
        reset();
        router.push(`/novels/${novelId}`);
      } else {
        const existingChapters = await db.chapters
          .where("novelId")
          .equals(selectedNovelId)
          .sortBy("order");
        const startOrder =
          existingChapters.length > 0
            ? Math.max(...existingChapters.map((c) => c.order)) + 1
            : 0;

        await db.transaction(
          "rw",
          [db.novels, db.chapters, db.scenes],
          async () => {
            await db.novels.update(selectedNovelId, {
              sourceUrl: url,
              updatedAt: now,
              ...(novelInfo?.coverImage
                ? { coverImage: novelInfo.coverImage }
                : {}),
            });
            await insertChapters(selectedNovelId, startOrder, now);
          },
        );
        const novelName =
          novels?.find((n) => n.id === selectedNovelId)?.title ?? "truyện";
        toast.success(
          `Đã thêm ${scrapedChapters.length} chương vào "${novelName}"`,
        );
        reset();
        router.push(`/novels/${selectedNovelId}`);
      }
    } catch (error) {
      toast.error(
        `Nhập thất bại: ${error instanceof Error ? error.message : "Lỗi không xác định"}`,
      );
    } finally {
      setIsImporting(false);
    }
  };

  const insertChapters = async (
    novelId: string,
    startOrder: number,
    now: Date,
  ) => {
    const existingChapters = await db.chapters.where("novelId").equals(novelId).toArray();
    const existingByTitle = new Map(existingChapters.map(c => [c.title, c]));

    for (let i = 0; i < scrapedChapters.length; i++) {
      const ch = scrapedChapters[i];
      const plainText = stripHtml(ch.content);
      const existing = existingByTitle.get(ch.title);

      if (existing) {
        // Find active scene and update it
        const scenes = await db.scenes.where("chapterId").equals(existing.id).toArray();
        const activeScene = scenes.find(s => s.isActive === 1);
        if (activeScene) {
          await db.scenes.update(activeScene.id, {
            content: ch.content,
            wordCount: countWords(plainText),
            updatedAt: now,
          });
        } else {
          // If no active scene found, create one
          await db.scenes.add({
            id: crypto.randomUUID(),
            chapterId: existing.id,
            novelId,
            title: ch.title,
            content: ch.content,
            order: 0,
            wordCount: countWords(plainText),
            version: 0,
            versionType: "manual",
            isActive: 1,
            createdAt: now,
            updatedAt: now,
          });
        }
      } else {
        const chapterId = crypto.randomUUID();
        await db.chapters.add({
          id: chapterId,
          novelId,
          title: ch.title,
          order: ch.order ?? (startOrder + i),
          createdAt: now,
          updatedAt: now,
        });

        await db.scenes.add({
          id: crypto.randomUUID(),
          chapterId,
          novelId,
          title: ch.title,
          content: ch.content,
          order: 0,
          wordCount: countWords(plainText),
          version: 0,
          versionType: "manual",
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Xem trước & Nhập</CardTitle>
        <CardDescription className="flex items-center gap-2">
          <span>
            {scrapedChapters.length} chương · {totalWords.toLocaleString()} từ
          </span>
          {warnCount > 0 && (
            <Badge
              variant={showOnlyWarnings ? "default" : "secondary"}
              className={cn(
                "gap-1 cursor-pointer transition-all",
                showOnlyWarnings 
                  ? "bg-amber-500 text-white hover:bg-amber-600" 
                  : "border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 hover:bg-amber-100"
              )}
              onClick={() => setShowOnlyWarnings(!showOnlyWarnings)}
            >
              <AlertTriangleIcon className="size-3" />
              {showOnlyWarnings ? `Đang hiện ${warnCount} cảnh báo` : `${warnCount} cảnh báo`}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-primary"
            onClick={() => useScraperStore.getState().scanForErrors()}
          >
            <RefreshCwIcon className="mr-1 size-2.5" />
            Quét chương lỗi
          </Button>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {novelMatchedBySourceUrl &&
          mode === "existing" &&
          selectedNovelId === novelMatchedBySourceUrl.id && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground">
              <Link2Icon className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                Đã khớp{" "}
                <span className="font-medium">link nguồn</span> với truyện có
                sẵn «{novelMatchedBySourceUrl.title}» — có thể thêm chương vào
                đây hoặc chuyển sang «Tạo truyện mới».
              </span>
            </div>
          )}

        {/* Mode tabs */}
        <div className="flex rounded-lg bg-muted p-1">
          <button
            onClick={() => setMode("new")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "new"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <PlusIcon className="size-3.5" />
            Tạo truyện mới
          </button>
          <button
            onClick={() => setMode("existing")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "existing"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookPlusIcon className="size-3.5" />
            Thêm vào truyện có sẵn
          </button>
        </div>

        {mode === "new" ? (
          <div className="space-y-3">
            <div>
              <Label htmlFor="novel-title" className="text-xs">
                Tiêu đề
              </Label>
              <Input
                id="novel-title"
                value={novelTitle}
                onChange={(e) => setNovelTitle(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="novel-desc" className="text-xs">
                Mô tả
              </Label>
              <Textarea
                id="desc"
                value={novelDescription}
                onChange={(e) => setNovelDescription(e.target.value)}
                placeholder="Mô tả ngắn gọn (không bắt buộc)..."
                rows={4}
                className="mt-1 max-h-48 overflow-y-auto"
              />
            </div>
          </div>
        ) : (
          <div>
            <Label className="text-xs">Chọn truyện</Label>
            <Select value={selectedNovelId} onValueChange={setSelectedNovelId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Chọn truyện để thêm chương..." />
              </SelectTrigger>
              <SelectContent>
                {novels?.map((novel) => (
                  <SelectItem key={novel.id} value={novel.id}>
                    <div className="flex items-center gap-2">
                      <LibraryIcon className="size-3 text-muted-foreground" />
                      {novel.title}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <VirtualPreviewChapterRows
          chapters={displayedChapters}
          retryingIndex={retryingIndex}
          onRetry={(i) => {
            // Re-map index if filtering is active
            const chapterToRetry = displayedChapters[i];
            const realIndex = scrapedChapters.findIndex(ch => ch.title === chapterToRetry.title);
            useScraperStore.getState().retryScrapeChapter(realIndex);
          }}
        />

        <div className="flex justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useScraperStore.getState().setStep("select")}
          >
            Quay lại
          </Button>
          <Button onClick={handleImport} disabled={isImporting}>
            {isImporting ? (
              <>
                <LoaderIcon className="mr-1.5 size-3.5 animate-spin" />
                Đang nhập...
              </>
            ) : mode === "new" ? (
              "Tạo & nhập truyện"
            ) : (
              "Thêm vào truyện"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Debug Toolbar (compact icon strip) ────────────────────

function LogData({ data }: { data: string }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(data);
  } catch {
    // not JSON
  }

  if (parsed && typeof parsed === "object") {
    return (
      <div className="mt-0.5 max-h-[140px] overflow-auto rounded bg-muted/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {Object.entries(parsed as Record<string, unknown>).map(
          ([key, value]) => (
            <div key={key} className="flex gap-1.5">
              <span className="shrink-0 font-medium text-foreground/70">
                {key}:
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-all">
                {typeof value === "object" && value !== null
                  ? JSON.stringify(value)
                  : String(value ?? "—")}
              </span>
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <pre className="mt-0.5 max-h-[140px] overflow-auto rounded bg-muted/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
      {data}
    </pre>
  );
}

function DebugToolbar() {
  const { debugLogs, clearDebugLogs } = useScraperStore();
  const logCount = debugLogs.length;

  const copyAll = () => {
    const text = debugLogs
      .map((log) => `[${log.timestamp}] ${log.label}\n${log.data}`)
      .join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    toast.success("Đã copy debug logs");
  };

  if (logCount === 0) return null;

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button className="relative flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <TerminalIcon className="size-3.5" />
          <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
            {logCount > 9 ? "9+" : logCount}
          </span>
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-0 w-5xl max-w-[95vw] mx-auto">
          <div className="flex items-center gap-2">
            <DrawerTitle className="text-sm">Debug Logs</DrawerTitle>
            <Badge
              variant="default"
              className="gap-1 border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
            >
              {logCount} log{logCount !== 1 ? "s" : ""}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={copyAll}
              title="Copy tất cả"
            >
              <ClipboardCopyIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearDebugLogs}
              title="Xóa logs"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon-sm">
                <XIcon className="size-3.5" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>
        <ScrollArea className="h-[40vh] px-4 pb-4 w-5xl max-w-[95vw] mx-auto">
          <div className="space-y-2">
            {debugLogs.map((log, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] tabular-nums text-muted-foreground/50">
                    {log.timestamp}
                  </span>
                  <span className="text-[11px] font-medium">{log.label}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(log.data);
                      toast.success("Copied");
                    }}
                    className="ml-auto text-[10px] text-muted-foreground/40 hover:text-foreground"
                  >
                    copy
                  </button>
                </div>
                <LogData data={log.data} />
              </div>
            ))}
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
