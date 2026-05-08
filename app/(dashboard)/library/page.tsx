"use client";

import { CreateNovelDialog } from "@/components/create-novel-dialog";
import { EditNovelDialog } from "@/components/edit-novel-dialog";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { db, type Novel } from "@/lib/db";
import { deleteNovel, useNovels } from "@/lib/hooks";
import { downloadNovelJson, exportNovel, importNovel } from "@/lib/novel-io";
import {
  BookOpenIcon,
  DownloadIcon,
  GridIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
  BookDownIcon,
  LanguagesIcon,
  LoaderIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { generateEpub } from "@/lib/epub-generator";
import { useApiInferenceProviders, useAIModels } from "@/lib/hooks/use-ai-providers";

type SortField = "updatedAt" | "createdAt" | "title";
type SortDirection = "asc" | "desc";
type ViewMode = "grid" | "list";

const ITEMS_PER_PAGE = 12;

const SORT_OPTIONS: {
  value: `${SortField}-${SortDirection}`;
  label: string;
}[] = [
  { value: "updatedAt-desc", label: "Cập nhật gần nhất" },
  { value: "updatedAt-asc", label: "Cập nhật cũ nhất" },
  { value: "createdAt-desc", label: "Mới tạo nhất" },
  { value: "createdAt-asc", label: "Cũ nhất" },
  { value: "title-asc", label: "Tên A → Z" },
  { value: "title-desc", label: "Tên Z → A" },
];

function sortNovels(
  novels: Novel[],
  field: SortField,
  direction: SortDirection,
) {
  return [...novels].sort((a, b) => {
    let cmp: number;
    if (field === "title") {
      cmp = a.title.localeCompare(b.title, "vi");
    } else {
      cmp = a[field].getTime() - b[field].getTime();
    }
    return direction === "asc" ? cmp : -cmp;
  });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function LibraryPage() {
  const novels = useNovels();
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] =
    useState<`${SortField}-${SortDirection}`>("updatedAt-desc");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Novel | null>(null);
  const [editTarget, setEditTarget] = useState<Novel | null>(null);
  const [translateTarget, setTranslateTarget] = useState<Novel | null>(null);

  const providers = useApiInferenceProviders();
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isTranslating, setIsTranslating] = useState(false);
  const models = useAIModels(selectedProvider);

  // Auto-select first provider and model
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

  const genres = useMemo(() => {
    if (!novels) return [];
    const set = new Set<string>();
    for (const n of novels) {
      if (n.genre) set.add(n.genre);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [novels]);

  const filtered = useMemo(() => {
    if (!novels) return [];

    let result = novels;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.description?.toLowerCase().includes(q),
      );
    }

    if (genreFilter !== "all") {
      result = result.filter((n) => n.genre === genreFilter);
    }

    const [field, direction] = sort.split("-") as [SortField, SortDirection];
    result = sortNovels(result, field, direction);

    return result;
  }, [novels, search, genreFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const handleGenre = (value: string) => {
    setGenreFilter(value);
    setPage(1);
  };
  const handleSort = (value: string) => {
    setSort(value as `${SortField}-${SortDirection}`);
    setPage(1);
  };

  const handleExportEpub = useCallback(async (novel: Novel) => {
    try {
      toast.info("Đang tạo file EPUB, vui lòng đợi...");
      const chapters = await db.chapters.where("novelId").equals(novel.id).sortBy("orderIndex");
      
      if (!chapters || chapters.length === 0) {
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
      
      const blob = await generateEpub(novel.title, novel.author || "Unknown", coverBase64 as string | null, chapters);
      
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
  }, []);

  const handleTranslateTitle = async () => {
    if (!translateTarget || !selectedProvider || !selectedModel) return;
    
    const activeProvider = providers?.find(p => p.id === selectedProvider);
    if (!activeProvider) return;
    
    try {
      setIsTranslating(true);
      const targetUrl = activeProvider.providerType === "anthropic" 
         ? "https://api.anthropic.com/v1/messages" 
         : activeProvider.providerType === "google"
           ? `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${activeProvider.apiKey}`
           : `${activeProvider.baseUrl?.replace(/\/+$/, "")}/chat/completions`;
           
      let body: any;
      const sysMsg = "Bạn là biên dịch viên truyện chữ chuyên nghiệp. Chỉ trả về kết quả dịch tiếng Việt của tên truyện, không thêm bất kỳ câu chữ nào khác, không dùng ngoặc kép.";
      const usrMsg = `Dịch tên truyện này sang tiếng Việt: ${translateTarget.title}`;
      
      if (activeProvider.providerType === "anthropic") {
         body = {
            model: selectedModel,
            system: sysMsg,
            messages: [{ role: "user", content: usrMsg }],
            max_tokens: 100,
         };
      } else if (activeProvider.providerType === "google") {
         body = {
            contents: [
              { role: "user", parts: [{ text: `${sysMsg}\n\n${usrMsg}` }] }
            ]
         };
      } else {
         body = {
            model: selectedModel,
            messages: [
              { role: "system", content: sysMsg },
              { role: "user", content: usrMsg }
            ]
         };
      }

      const res = await fetch("/api/ai-proxy", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-target-url": targetUrl,
          "Authorization": `Bearer ${activeProvider.apiKey}`,
        },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) throw new Error("Lỗi gọi API dịch");
      const data = await res.json();
      
      let translated = "";
      if (activeProvider.providerType === "anthropic") {
         translated = data.content?.[0]?.text;
      } else if (activeProvider.providerType === "google") {
         translated = data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else {
         translated = data.choices?.[0]?.message?.content;
      }
      
      translated = translated?.trim();
      if (!translated) throw new Error("Không nhận được kết quả dịch");
      
      await db.novels.update(translateTarget.id, { title: translated });
      toast.success("Đã dịch tên truyện thành công!");
      setTranslateTarget(null);
    } catch (e: any) {
      toast.error(e.message || "Không thể dịch tên truyện");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleExport = useCallback(async (novel: Novel) => {
    try {
      const data = await exportNovel(novel.id);
      downloadNovelJson(data);
      toast.success(`Đã xuất "${novel.title}"`);
    } catch {
      toast.error("Xuất tiểu thuyết thất bại.");
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteNovel(deleteTarget.id);
      toast.success(`Đã xóa "${deleteTarget.title}"`);
    } catch {
      toast.error("Xóa tiểu thuyết thất bại.");
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset so the same file can be re-selected
      e.target.value = "";
      try {
        await importNovel(file);
        toast.success("Đã nhập tiểu thuyết thành công!");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Nhập tiểu thuyết thất bại.",
        );
      }
    },
    [],
  );

  // Loading state
  if (novels === undefined) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="mb-6 flex gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-44" />
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-3/4 w-full rounded-lg bg-muted" />
              <div className="mt-2 space-y-1.5 px-0.5">
                <div className="h-3 w-4/5 rounded bg-muted" />
                <div className="h-2.5 w-3/5 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex sm:items-end justify-between gap-4 flex-col sm:flex-row">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            Thư viện
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {novels.length} tiểu thuyết
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => importInputRef.current?.click()}
          >
            <UploadIcon className="size-4" />
            Nhập sách
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            Tạo mới
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm kiếm tiểu thuyết..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-8 pr-8"
          />
          {search && (
            <button
              onClick={() => handleSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

        {genres.length > 0 && (
          <Select value={genreFilter} onValueChange={handleGenre}>
            <SelectTrigger>
              <SelectValue placeholder="Thể loại" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">Tất cả thể loại</SelectItem>
              {genres.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={sort} onValueChange={handleSort}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as ViewMode)}
          variant="outline"
          size="sm"
          className="ml-auto"
        >
          <ToggleGroupItem value="grid" aria-label="Dạng lưới">
            <GridIcon className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Dạng danh sách">
            <ListIcon className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Empty states */}
      {novels.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpenIcon />
                </EmptyMedia>
                <EmptyTitle>Thư viện trống</EmptyTitle>
                <EmptyDescription>
                  Tạo tiểu thuyết đầu tiên hoặc nhập từ nguồn có sẵn.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>Không tìm thấy kết quả</EmptyTitle>
                <EmptyDescription>
                  Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Grid view */}
          {view === "grid" && (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {paginated.map((novel) => (
                <div
                  key={novel.id}
                  className="group cursor-pointer"
                  onClick={() => router.push(`/novels/${novel.id}`)}
                >
                  {/* Book cover — 2:3 ratio */}
                  <div className="relative aspect-3/4 w-full overflow-hidden rounded-lg bg-muted shadow-sm transition-shadow group-hover:shadow-md">
                    {novel.coverImage ? (
                      <>
                        <img
                          src={novel.coverImage}
                          alt={novel.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                        {novel.color && (
                          <div
                            className="absolute inset-x-0 bottom-0 h-1"
                            style={{ backgroundColor: novel.color }}
                          />
                        )}
                      </>
                    ) : (
                      /* Placeholder with accent color + title */
                      <div
                        className="flex h-full flex-col justify-center items-center p-3 font-serif"
                        style={{
                          background: novel.color
                            ? `linear-gradient(160deg, ${novel.color}20 0%, ${novel.color}99 100%)`
                            : undefined,
                        }}
                      >
                        <p className="line-clamp-3 text-sm font-semibold leading-snug text-foreground/80">
                          {novel.title}
                        </p>
                        {novel.author && (
                          <p className="mt-1 truncate text-[10px] text-muted-foreground">
                            {novel.author}
                          </p>
                        )}
                      </div>
                    )}
                    {/* Genre badges overlay */}
                    {novel.genres && novel.genres.length > 0 && (
                      <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-linear-to-t from-black/60 to-transparent p-2 pt-4">
                        {novel.genres.slice(0, 2).map((g) => (
                          <span
                            key={g}
                            className="rounded-sm bg-black/40 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/90 backdrop-blur-sm"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Hover actions */}
                    <div
                      className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <NovelActions
                        novel={novel}
                        onEdit={setEditTarget}
                        onExport={handleExport}
                        onExportEpub={handleExportEpub}
                        onDelete={setDeleteTarget}
                        onTranslate={setTranslateTarget}
                      />
                    </div>
                  </div>

                  {/* Info below cover */}
                  <div className="mt-2 px-0.5">
                    <p className="line-clamp-2 text-xs font-medium leading-snug">
                      {novel.title}
                    </p>
                    {novel.author && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {novel.author}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground/50">
                      {formatDate(novel.updatedAt)}
                    </p>
                    <NovelTranslateProgress novelId={novel.id} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* List view */}
          {view === "list" && (
            <div className="flex flex-col gap-1.5">
              {paginated.map((novel) => (
                <Card
                  key={novel.id}
                  className="group cursor-pointer transition-colors hover:bg-muted/30 py-0"
                  onClick={() => router.push(`/novels/${novel.id}`)}
                >
                  <CardContent className="flex items-center gap-3 py-2.5 px-3">
                    {/* Thumbnail — 2:3 ratio, h-12 */}
                    <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-muted">
                      {novel.coverImage ? (
                        <img
                          src={novel.coverImage}
                          alt={novel.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          className="h-full w-full"
                          style={{
                            background: novel.color
                              ? `linear-gradient(160deg, ${novel.color}44 0%, ${novel.color}bb 100%)`
                              : undefined,
                          }}
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {novel.title}
                      </p>
                      {novel.author && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {novel.author}
                        </p>
                      )}
                    </div>

                    {novel.genres && novel.genres.length > 0 && (
                      <div className="hidden shrink-0 gap-1 sm:flex">
                        {novel.genres.slice(0, 2).map((g) => (
                          <Badge
                            key={g}
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {g}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col items-end shrink-0 gap-1">
                      <span className="text-[11px] text-muted-foreground/50">
                        {formatDate(novel.updatedAt)}
                      </span>
                      <NovelTranslateProgress novelId={novel.id} />
                    </div>

                    <div onClick={(e) => e.stopPropagation()}>
                      <NovelActions
                        novel={novel}
                        onEdit={setEditTarget}
                        onExport={handleExport}
                        onExportEpub={handleExportEpub}
                        onDelete={setDeleteTarget}
                        onTranslate={setTranslateTarget}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {(currentPage - 1) * ITEMS_PER_PAGE + 1}–
                {Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} /{" "}
                {filtered.length}
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      text="Trước"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-disabled={currentPage === 1}
                      className={
                        currentPage === 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                  {paginationRange(currentPage, totalPages).map((item, i) =>
                    item === "..." ? (
                      <PaginationItem key={`e-${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={item}>
                        <PaginationLink
                          isActive={item === currentPage}
                          onClick={() => setPage(item)}
                          className="cursor-pointer"
                        >
                          {item}
                        </PaginationLink>
                      </PaginationItem>
                    ),
                  )}
                  <PaginationItem>
                    <PaginationNext
                      text="Sau"
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      aria-disabled={currentPage === totalPages}
                      className={
                        currentPage === totalPages
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa tiểu thuyết?</AlertDialogTitle>
            <AlertDialogDescription>
              Tiểu thuyết <strong>&ldquo;{deleteTarget?.title}&rdquo;</strong>{" "}
              cùng toàn bộ chương, cảnh, nhân vật và ghi chú sẽ bị xóa vĩnh
              viễn.
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

      <CreateNovelDialog open={createOpen} onOpenChange={setCreateOpen} />

      {editTarget && (
        <EditNovelDialog
          open={!!editTarget}
          onOpenChange={(open) => !open && setEditTarget(null)}
          novel={editTarget}
        />
      )}

      {/* Translate Title Dialog */}
      <Dialog open={!!translateTarget} onOpenChange={(open) => !open && setTranslateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dịch tên truyện</DialogTitle>
            <DialogDescription>
              Tên gốc: <strong className="text-foreground">{translateTarget?.title}</strong>
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nhà cung cấp (Provider)</label>
              <Select value={selectedProvider} onValueChange={setSelectedProvider} disabled={isTranslating}>
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
              <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isTranslating || !models || models.length === 0}>
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
            <Button variant="outline" onClick={() => setTranslateTarget(null)} disabled={isTranslating}>Hủy</Button>
            <Button onClick={handleTranslateTitle} disabled={isTranslating || !selectedModel}>
              {isTranslating ? <LoaderIcon className="w-4 h-4 mr-2 animate-spin" /> : <LanguagesIcon className="w-4 h-4 mr-2" />}
              Dịch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

// ─── Novel actions dropdown ─────────────────────────────────

function NovelActions({
  novel,
  onEdit,
  onExport,
  onExportEpub,
  onDelete,
  onTranslate,
}: {
  novel: Novel;
  onEdit: (novel: Novel) => void;
  onExport: (novel: Novel) => void;
  onExportEpub: (novel: Novel) => void;
  onDelete: (novel: Novel) => void;
  onTranslate: (novel: Novel) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onEdit(novel)}
          >
            <PencilIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Chỉnh sửa</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
            onClick={() => onTranslate(novel)}
          >
            <LanguagesIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Dịch tên truyện</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
            onClick={() => onExportEpub(novel)}
          >
            <BookDownIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Xuất EPUB</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onExport(novel)}
          >
            <DownloadIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Xuất JSON</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(novel)}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Xóa</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Pagination helper ──────────────────────────────────────

function paginationRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

// ─── Translation Progress Indicator ─────────────────────────────

function NovelTranslateProgress({ novelId }: { novelId: string }) {
  const job = useBulkTranslateStore((s) => s.jobs[novelId]);
  if (!job || (!job.isRunning && job.step !== "progress")) return null;
  
  const percent = job.totalChapters > 0 ? Math.round((job.chaptersCompleted / job.totalChapters) * 100) : 0;
  
  return (
    <div className="flex w-full items-center justify-between text-[10px] font-medium text-emerald-600 dark:text-emerald-500 mt-0.5">
      <span className="truncate pr-2">Đang dịch {job.chaptersCompleted}/{job.totalChapters}</span>
      <span>{percent}%</span>
    </div>
  );
}
