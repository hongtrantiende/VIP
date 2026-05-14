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
import { downloadNovelJson, exportNovel, importNovel, isSceneTranslated } from "@/lib/novel-io";
import { CollectionManager } from "@/components/collection-manager";
import { CategorizeNovelsDialog } from "@/components/categorize-novels-dialog";
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
  CloudDownloadIcon,
  CloudUploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { useScraperQueueStore } from "@/lib/stores/scraper-queue";
import { generateEpub } from "@/lib/epub-generator";
import { useApiInferenceProviders, useAIModels } from "@/lib/hooks/use-ai-providers";
import { generateText } from "ai";
import { resolveStep } from "@/lib/ai/resolve-step";
import { useGoogleDrive } from "@/lib/hooks/use-google-drive";
import { buildExportPayload, importDatabase } from "@/lib/db-io";
import { ProgressDialog } from "@/components/progress-dialog";
import type { ProgressInfo } from "@/lib/db-io";

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

  // Drive sync state
  const drive = useGoogleDrive();
  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleBackupToDrive = async () => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước.");
      drive.login();
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(null);
    setResult(null);
    setProgressOpen(true);
    const toastId = toast.loading("Đang đóng gói và tải lên Drive...");

    try {
      const payload = await buildExportPayload({
        includeAISettings: true,
        includeConversations: true,
        includeLargeDictionaryData: false, // Không xuất từ điển vì đã dùng kho chung Supabase
        signal: ac.signal,
        onProgress: setProgress,
      });

      const filename = "novel-studio-library-backup.json";
      await drive.uploadFile(filename, payload.json);
      toast.success("Đã sao lưu thư viện lên Google Drive thành công!", { id: toastId });
      setResult({ success: true, message: "Sao lưu Drive thành công!" });
    } catch (err: any) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setResult({ success: false, message: "Đã huỷ sao lưu." });
        toast.dismiss(toastId);
      } else {
        const msg = err instanceof Error ? err.message : "Lỗi không xác định.";
        setResult({ success: false, message: msg });
        toast.error(`Lỗi: ${msg}`, { id: toastId });
      }
    }
  };

  const handleUploadNovelToCloud = async (novel: Novel) => {
    const toastId = toast.loading(`Đang lưu "${novel.title}" lên Tổng kho...`);
    try {
      const data = await exportNovel(novel.id, { includeVersions: true });
      const json = JSON.stringify(data);
      const filename = `novel_data.json`;
      const params = new URLSearchParams({ action: 'upload', novelName: novel.title });
      const res = await fetch(`/api/dict/cloud-storage?${params.toString()}`, { method: 'POST', body: json });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Đã sao lưu "${novel.title}" thành công!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleDownloadNovelFromCloud = async (novel: Novel) => {
    const toastId = toast.loading(`Đang nhập "${novel.title}" từ Tổng kho...`);
    try {
      const params = new URLSearchParams({ action: 'download', novelName: novel.title });
      const res = await fetch(`/api/dict/cloud-storage?${params.toString()}`, { method: 'POST' });
      if (!res.ok) {
        if (res.status === 404) throw new Error("Không tìm thấy bản sao lưu.");
        throw new Error(await res.text());
      }
      const json = await res.text();
      const file = new File([json], "novel_data.json", { type: "application/json" });
      await importNovel(file);
      toast.success(`Đã nhập "${novel.title}" thành công!`, { id: toastId });
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleUploadAllToCloud = async () => {
    if (!novels || novels.length === 0) {
      toast.error("Không có truyện nào để tải lên.");
      return;
    }

    const toastId = toast.loading(`Đang chuẩn bị tải lên ${novels.length} truyện...`);
    try {
      let processed = 0;
      const total = novels.length;
      const CONCURRENCY = 3; // Giảm xuống 3 vì mỗi truyện giờ tải lên 3 file (JSON, Trung, Việt)

      for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = novels.slice(i, i + CONCURRENCY);
        
        await Promise.allSettled(
          batch.map(async (novel) => {
            try {
              // 1. Xuất dữ liệu JSON (Metadata & Chapters)
              const data = await exportNovel(novel.id, { includeVersions: true });
              const json = JSON.stringify(data);
              
              // 2. Trích xuất Text Trung & Việt từ các chương
              const chapters = data.chapters || [];
              const scenes = data.scenes || [];
              
              // Sắp xếp chương theo order
              const sortedChapters = [...chapters].sort((a, b) => a.order - b.order);
              
              let fullChinese = "";
              let fullVietnamese = "";
              let hasTranslation = false;
              
              for (const ch of sortedChapters) {
                const chScenes = scenes
                  .filter(s => s.chapterId === ch.id && s.isActive)
                  .sort((a, b) => a.order - b.order);
                
                const chTitle = ch.title || "Không tiêu đề";
                
                // Trích xuất bản gốc (Original version = 1)
                const originalScenes = chScenes.map(a => {
                    const orig = scenes.find(s => s.activeSceneId === a.id && s.version === 1);
                    return orig || a;
                });
                const chChinese = originalScenes.map(s => s.content || "").join("\n\n");
                
                // Trích xuất bản dịch
                const isChapterTranslated = chScenes.some(isSceneTranslated);
                const chVietnamese = isChapterTranslated 
                  ? chScenes.map(s => s.content.replace("Bạn đang xem văn bản gốc chưa dịch, có thể kéo xuống cuối trang để chọn bản dịch.", "").trim()).join("\n\n") 
                  : "";

                if (chChinese.trim()) {
                  fullChinese += `\n\n=== ${chTitle} ===\n\n${chChinese}`;
                }
                
                if (chVietnamese.trim()) {
                  fullVietnamese += `\n\n=== ${chTitle} ===\n\n${chVietnamese}`;
                  hasTranslation = true;
                }
              }

              const jsonParams = new URLSearchParams({ action: 'upload', novelName: novel.title });
              const txtTrungParams = new URLSearchParams({ action: 'upload-txt', type: 'text_trung', novelName: novel.title });
              const txtDichParams = new URLSearchParams({ action: 'upload-txt', type: 'text_dich', novelName: novel.title });

              // Tải lên 3 file song song vào 2 kho khác nhau
              await Promise.all([
                fetch(`/api/dict/cloud-storage?${jsonParams.toString()}`, { 
                  method: 'POST', body: json 
                }),
                fullChinese.trim() && fetch(`/api/dict/cloud-storage?${txtTrungParams.toString()}`, { 
                  method: 'POST', body: fullChinese 
                }),
                hasTranslation && fetch(`/api/dict/cloud-storage?${txtDichParams.toString()}`, { 
                  method: 'POST', body: fullVietnamese 
                })
              ]);

              processed++;
            } catch (err) {
              console.error(`Failed to upload novel ${novel.title}:`, err);
            }
          })
        );
        
        toast.loading(`Đang tải lên: ${Math.round((i + batch.length) / total * 100)}%...`, { id: toastId });
      }

      toast.success(`Đã tải lên xong ${processed}/${total} truyện (Kèm file TXT Trung/Việt)!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi đồng bộ: ${err.message}`, { id: toastId });
    }
  };

  const handleDownloadAllFromCloud = async () => {
    const toastId = toast.loading("Đang quét và tải toàn bộ truyện từ Kho của bạn...");
    try {
      const listParams = new URLSearchParams({ action: 'download-all' });
      const listRes = await fetch(`/api/dict/cloud-storage?${listParams.toString()}`, { method: 'POST' });
      if (!listRes.ok) {
        const errorData = await listRes.json().catch(() => ({ error: 'Không thể parse JSON lỗi' }));
        throw new Error(errorData.error || `Lỗi kết nối: ${listRes.status}`);
      }
      
      const listData = await listRes.json();
      const novelsToImport = listData.novels || []; // Mảng chứa {name, content}

      if (novelsToImport.length === 0) {
        toast.error("Kho của bạn đang trống. Hãy 'Lưu lên Kho' trước nhé!", { id: toastId });
        return;
      }

      toast.loading(`Đang khôi phục ${novelsToImport.length} truyện vào thư viện...`, { id: toastId });

      let processed = 0;
      let failedNames: string[] = [];
      const total = novelsToImport.length;
      const CONCURRENCY = 3;

      for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = novelsToImport.slice(i, i + CONCURRENCY);
        
        await Promise.allSettled(
          batch.map(async (novelData: { name: string, content: string }) => {
            try {
              // Ensure we have json syntax checked
              const data = JSON.parse(novelData.content); 
              const file = new File([novelData.content], `${novelData.name}.json`, { type: "application/json" });
              const newNovelId = await importNovel(file, { preserveId: true });
              
              if (data.novel?.sourceUrl) {
                await useScraperQueueStore.getState().restoreJobFromDB(
                  newNovelId,
                  data.novel.title,
                  data.novel.sourceUrl,
                  data.novel.coverImage
                );
              }
              processed++;
            } catch (err) {
              failedNames.push(novelData.name);
              console.error(`Failed to import novel ${novelData.name}:`, err);
            }
          })
        );
        
        if (i + CONCURRENCY < total) {
          await new Promise(r => setTimeout(r, 100));
        }

        toast.loading(`Đang khôi phục: ${Math.round(Math.min(i + batch.length, total) / total * 100)}% (${processed} xong)...`, { id: toastId });
      }

      if (processed > 0) {
        const failMsg = failedNames.length > 0 ? ` (Thất bại ${failedNames.length}: ${failedNames.slice(0, 2).join(", ")}...)` : "";
        toast.success(`Đồng bộ thành công ${processed} truyện!${failMsg}`, { id: toastId, duration: 5000 });
        setTimeout(() => window.location.reload(), 2000);
      } else {
        toast.error(`Không có truyện nào được tải về. Thất bại: ${failedNames.join(", ")}`, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Lỗi cập nhật: ${err.message}`, { id: toastId });
    }
  };

  const handleRestoreFromDrive = async () => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước.");
      drive.login();
      return;
    }
    
    const toastId = toast.loading("Đang tìm và tải bản sao lưu từ Drive...");
    try {
      const text = await drive.downloadFile("novel-studio-library-backup.json");
      if (!text) {
        toast.error(`Không tìm thấy bản sao lưu nào trên Drive. Vui lòng sao lưu trước!`, { id: toastId });
        return;
      }
      
      const file = new File([text], "novel-studio-library-backup.json", { type: "application/json" });
      toast.success("Đã tải tệp về, chuẩn bị phục hồi...", { id: toastId });
      
      const ac = new AbortController();
      abortRef.current = ac;
      setProgress(null);
      setResult(null);
      setProgressOpen(true);

      await importDatabase(
        file,
        { conflictMode: "overwrite", signal: ac.signal, onProgress: setProgress }
      );
      setResult({ success: true, message: "Nhập dữ liệu thành công!" });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setResult({ success: false, message: "Đã huỷ nhập dữ liệu." });
      } else {
        const msg = err instanceof Error ? err.message : "Lỗi không xác định.";
        setResult({ success: false, message: msg });
        toast.error(`Lỗi tải từ Drive: ${msg}`, { id: toastId });
      }
    }
  };
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
  const handleSort = (value: string) => {
    setSort(value as `${SortField}-${SortDirection}`);
    setPage(1);
  };

  const handleExportEpub = useCallback(async (novel: Novel) => {
    try {
      toast.info("Đang tạo file EPUB, vui lòng đợi...");
      const chapters = await db.chapters.where("novelId").equals(novel.id).sortBy("order");
      
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
      
      const scenes = await db.scenes.where("[novelId+isActive]").equals([novel.id, 1]).toArray();
      const chaptersWithContent = chapters.map(ch => {
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
  }, []);

  const handleTranslateTitle = async () => {
    if (!translateTarget || !selectedProvider || !selectedModel) return;
    
    try {
      setIsTranslating(true);

      const model = await resolveStep({ providerId: selectedProvider, modelId: selectedModel });
      if (!model) throw new Error("Không thể tải model AI");

      const sysMsg = "Bạn là biên dịch viên truyện chữ chuyên nghiệp. Chỉ trả về kết quả dịch tiếng Việt của tên truyện, không thêm bất kỳ câu chữ nào khác, không dùng ngoặc kép.";
      const usrMsg = `Dịch tên truyện này sang tiếng Việt: ${translateTarget.title}`;

      const { text } = await generateText({
        model,
        system: sysMsg,
        prompt: usrMsg,
      });

      const translated = text.trim();
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
        const text = await file.text();
        const data = JSON.parse(text);
        
        // Use a new File object with the same content since we already read it
        const newFile = new File([text], file.name, { type: file.type });
        const newNovelId = await importNovel(newFile);
        
        if (data.novel?.sourceUrl) {
          await useScraperQueueStore.getState().restoreJobFromDB(
            newNovelId,
            data.novel.title,
            data.novel.sourceUrl,
            data.novel.coverImage
          );
        }
        
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
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-500 border-emerald-500/30 hover:text-emerald-600 hover:bg-emerald-500/10 hidden sm:flex"
            onClick={handleDownloadAllFromCloud}
          >
            <CloudDownloadIcon className="size-4 mr-2" />
            Nhập từ Kho
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-emerald-500 border-emerald-500/30 hover:text-emerald-600 hover:bg-emerald-500/10 hidden sm:flex"
            onClick={handleUploadAllToCloud}
          >
            <CloudUploadIcon className="size-4 mr-2" />
            Lưu lên Kho
          </Button>

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
            <span className="hidden sm:inline ml-2">Nhập sách</span>
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            <span className="hidden sm:inline ml-2">Tạo mới</span>
          </Button>
        </div>
      </div>

      <CollectionManager 
        novels={novels} 
        activeGenre={genreFilter} 
        onSelectGenre={(val) => { setGenreFilter(val); setPage(1); }} 
      />

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

        <CategorizeNovelsDialog novels={novels} />

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
                        onCloudUpload={handleUploadNovelToCloud}
                        onCloudDownload={handleDownloadNovelFromCloud}
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
                        onCloudUpload={handleUploadNovelToCloud}
                        onCloudDownload={handleDownloadNovelFromCloud}
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
      <ProgressDialog
        open={progressOpen}
        title="Đồng bộ Dữ liệu"
        progress={progress}
        result={result}
        onCancel={() => abortRef.current?.abort()}
        onClose={() => {
          setProgressOpen(false);
          setResult(null);
          setProgress(null);
        }}
      />
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
  onCloudUpload,
  onCloudDownload,
}: {
  novel: Novel;
  onEdit: (novel: Novel) => void;
  onExport: (novel: Novel) => void;
  onExportEpub: (novel: Novel) => void;
  onDelete: (novel: Novel) => void;
  onTranslate: (novel: Novel) => void;
  onCloudUpload: (novel: Novel) => void;
  onCloudDownload: (novel: Novel) => void;
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
            className="size-7 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
            onClick={() => onCloudUpload(novel)}
          >
            <CloudUploadIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Lưu lên Tổng kho</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
            onClick={() => onCloudDownload(novel)}
          >
            <CloudDownloadIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Nhập từ Tổng kho</TooltipContent>
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
