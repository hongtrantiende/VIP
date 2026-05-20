"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  NAME_ENTRY_CATEGORIES,
  type NameEntry,
} from "@/lib/db";
import {
  exportDictSource,
  importDictFile,
  loadDictFromPublic,
  useDictMeta,
  appendToDictSource,
} from "@/lib/hooks/use-dict-entries";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  bulkImportNameEntries,
  createNameEntry,
  deleteNameEntriesByScope,
  deleteNameEntry,
  updateNameEntry,
  useGlobalNameEntries,
  type DuplicateMode,
} from "@/lib/hooks/use-name-entries";
import { uploadDictServerAction } from "@/app/actions/dict-upload";
import { useNovels } from "@/lib/hooks/use-novels";
import { formatRelativeTime } from "@/lib/scene-version-utils";
import {
  BookTextIcon,
  DownloadIcon,
  Edit3,
  FileUpIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  CloudIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  ServerIcon,
  SaveIcon,
  BotIcon,
} from "lucide-react";
import { useGoogleDrive } from "@/lib/hooks/use-google-drive";

import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { compress } from "@/lib/compression";

import { DICT_GENRES, DICT_TYPES, type DictGenre, type DictType, type DictSource } from "@/lib/db";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";


export const GENRE_LABELS: Record<DictGenre, string> = {
  core: "Cơ Bản (Core)",
  hiendai: "Hiện Đại",
  tienhiep: "Tiên Hiệp",
  huyenhuyen: "Huyền Huyễn",
  dammi: "Đam Mỹ",
  hocduong: "Học Đường",
  dothi: "Đô Thị",
  vongdu: "Võng Du",
  dongnhan: "Đồng Nhân",
  ngontinh: "Ngôn Tình",
};

export const TYPE_LABELS: Record<DictType, string> = {
  vietphrase: "Từ Điển Chính (Thể Loại)",
  names: "Tên nhân vật, địa danh",
  names2: "Tên bổ sung",
  phienam: "Phiên âm ký tự đơn",
  luatnhan: "Luật nhân xưng {0}",
  tuvung: "Từ vựng thể loại",
  ngucanh: "Ngữ cảnh & Quy tắc",
};

/** Build page numbers with ellipsis: [0, 1, "ellipsis", 8, 9] */
function getPageRange(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);

  const pages: (number | "ellipsis")[] = [];
  // Always show first page
  pages.push(0);

  if (current > 2) pages.push("ellipsis");

  // Pages around current
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 3) pages.push("ellipsis");

  // Always show last page
  pages.push(total - 1);

  return pages;
}

// Render descriptions dynamically if needed, but we don't strictly need DICT_SOURCE_DESC anymore

const DICT_SOURCE_LABELS: Record<string, string> = new Proxy({}, { get: (_, prop) => String(prop) });
const ALL_SOURCES: DictSource[] = [];
for (const g of DICT_GENRES) {
  for (const t of DICT_TYPES) {
    if (g === "core" && t !== "vietphrase" && t !== "phienam") continue;
    ALL_SOURCES.push(`${g}_${t}` as DictSource);
  }
}

export function DictionaryManagement({ compact }: { compact?: boolean }) {
  const drive = useGoogleDrive();
  const dictMeta = useDictMeta();
  const novels = useNovels();
  const [selectedNovelId, setSelectedNovelId] = useState<string>("global");
  const globalEntries = useGlobalNameEntries();
  const [isReloading, setIsReloading] = useState(false);
  const [replacingSource, setReplacingSource] = useState<DictSource | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<"list" | "lookup" | "splitter">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<NameEntry | null>(null);
  const [newChinese, setNewChinese] = useState("");
  const [newVietnamese, setNewVietnamese] = useState("");
  const [newCategory, setNewCategory] = useState<string>("nhân vật");
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importCategory, setImportCategory] = useState<string>("nhân vật");
  const [importDuplicateMode, setImportDuplicateMode] =
    useState<DuplicateMode>("skip");
  const [importPending, setImportPending] = useState<Array<{
    chinese: string;
    vietnamese: string;
  }> | null>(null);
  const [importSourceLabel, setImportSourceLabel] = useState("");
  const nameFileInputRef = useRef<HTMLInputElement>(null);

  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "local">("all");

  const datasetMeta = useLiveQuery(async () => {
    const meta: Record<string, number> = {};
    for (const g of DICT_GENRES) {
      const source = `${g}_dataset`;
      const cached = await db.dictCache.get(source as any);
      if (cached?.rawText) {
        meta[source] = cached.rawText.split("\n").filter(Boolean).length;
      } else {
        meta[source] = 0;
      }
    }
    return meta;
  }, []);

  // Filter entries
  const filteredEntries = (globalEntries ?? [])
    .filter((e) => {
      const matchesSearch =
        !searchQuery ||
        e.chinese.includes(searchQuery) ||
        e.vietnamese.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        categoryFilter === "all" || e.category === categoryFilter;
      const matchesScope = 
        scopeFilter === "all" || e.scope === scopeFilter;
      return matchesSearch && matchesCategory && matchesScope;
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()); // Mới nhất lên đầu

  const handleReloadDicts = async () => {
    setIsReloading(true);
    try {
      await loadDictFromPublic();
      toast.success("Đã tải lại từ điển QT");
    } catch {
      toast.error("Lỗi khi tải từ điển");
    } finally {
      setIsReloading(false);
    }
  };

  const handleDownload = async (source: DictSource) => {
    try {
      await exportDictSource(source);
    } catch {
      toast.error("Lỗi khi xuất file");
    }
  };

  const handleSyncToLocalCode = async (source: DictSource) => {
    const toastId = toast.loading(`Đang đồng bộ ${DICT_SOURCE_LABELS[source]} vào mã nguồn...`);
    try {
      // Read from dictCache (fast) instead of dictEntries (slow)
      const cached = await db.dictCache.get(source);
      const text = cached?.rawText || "";
      
      const res = await fetch("/api/dev/sync-dict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, text }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đồng bộ");
      
      toast.success(`Đã lưu trực tiếp vào public/dict/${source}.txt!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleUploadToDrive = async (source: DictSource) => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước (Nút trên cùng)");
      return;
    }
    const toastId = toast.loading(`Đang tải ${DICT_SOURCE_LABELS[source]} lên Drive...`);
    try {
      // Read from dictCache (fast) instead of dictEntries (slow)
      const cached = await db.dictCache.get(source);
      const text = cached?.rawText || "";
      const filename = `${source}.txt`;
      await drive.uploadFile(filename, text);
      toast.success(`Đã tải ${filename} lên Google Drive!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleDownloadFromDrive = async (source: DictSource) => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước (Nút trên cùng)");
      return;
    }
    const filename = `${source}.txt`;
    const toastId = toast.loading(`Đang tải ${filename} từ Drive...`);
    try {
      const text = await drive.downloadFile(filename);
      if (!text) {
        toast.error(`Không tìm thấy file ${filename} trên Drive (trong thư mục Novel_Studio_Dicts)`, { id: toastId });
        return;
      }
      
      const entries = parseDictLines(text);
      const count = await appendToDictSource(source, entries);
      toast.success(`Đã tự động gộp ${count.toLocaleString()} mục mới từ Drive cho ${DICT_SOURCE_LABELS[source]}`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };



  const handleSyncToWarehouse = async (source: DictSource) => {
    const toastId = toast.loading(`Đang hòa nhập ${DICT_SOURCE_LABELS[source]} vào Kho chung...`);
    try {
      const cached = await db.dictCache.get(source);
      const localText = cached?.rawText || "";
      const filename = `${source}.txt`;

      // 1. Tải bản hiện tại trên Kho về để gộp (Sử dụng action mới)
      const dlParams = new URLSearchParams({ action: 'download-dict', filename });
      const dlRes = await fetch(`/api/dict/cloud-storage?${dlParams.toString()}`, { method: 'POST' });
      
      let finalContent = localText;
      if (dlRes.ok) {
        const cloudText = await dlRes.text();
        const localEntries = parseDictLines(localText);
        const cloudEntries = parseDictLines(cloudText);
        
        const map = new Map<string, Set<string>>();
        
        const addToMap = (e: { chinese: string; vietnamese: string }) => {
          const key = e.chinese.trim();
          const meanings = e.vietnamese.split("/").map(m => m.trim()).filter(Boolean);
          if (!map.has(key)) map.set(key, new Set());
          meanings.forEach(m => map.get(key)!.add(m));
        };

        cloudEntries.forEach(addToMap);
        localEntries.forEach(addToMap);
        
        finalContent = Array.from(map.entries())
          .map(([k, vs]) => `${k}=${Array.from(vs).join("/")}`)
          .join("\n");
      }

      // 2. Nén Gzip và tải lên trực tiếp (Single Compressed Upload)
      const compressed = await compress(finalContent);
      const uploadParams = new URLSearchParams({ action: 'upload-dict', filename });
      const res = await fetch(`/api/dict/cloud-storage?${uploadParams.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: compressed
      });

      if (!res.ok) {
        throw new Error(await res.text() || "Upload thất bại");
      }

      toast.success(`Đã hòa nhập và cập nhật ${filename} lên Kho chung!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleDownloadFromWarehouse = async (source: DictSource) => {
    const toastId = toast.loading(`Đang lấy ${DICT_SOURCE_LABELS[source]} từ Kho chung...`);
    try {
      const filename = `${source}.txt`;
      const params = new URLSearchParams({ action: 'download-dict', filename });
      const res = await fetch(`/api/dict/cloud-storage?${params.toString()}`, { method: 'POST' });
      if (!res.ok) throw new Error("Không tìm thấy dữ liệu trên Kho");
      
      const content = await res.text();
      const entries = parseDictLines(content);
      const count = await appendToDictSource(source, entries);
      toast.success(`Đã cập nhật ${count.toLocaleString()} mục mới từ Kho chung!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };



  const handleSyncAllToWarehouse = async () => {
    const toastId = toast.loading("Đang tối ưu và hòa nhập toàn bộ vào Tổng kho 1TB...");
    try {
      const sources = ALL_SOURCES;
      const total = sources.length;
      let successCount = 0;
      let processedCount = 0;

      // Chạy song song 5 bộ cùng lúc để tăng tốc
      const CONCURRENCY = 5;
      for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = sources.slice(i, i + CONCURRENCY);
        
        await Promise.allSettled(
          batch.map(async (source) => {
            const cached = await db.dictCache.get(source);
            processedCount++;
            
            // Nếu không có dữ liệu local, bỏ qua để tiết kiệm thời gian
            if (!cached?.rawText || cached.rawText.trim().length === 0) return;

            const filename = `${source}.txt`;
            const dlParams = new URLSearchParams({ action: 'download-dict', filename });
            const dlRes = await fetch(`/api/dict/cloud-storage?${dlParams.toString()}`, { method: 'POST' });
            
            let finalContent = cached.rawText;
            if (dlRes.ok) {
              const cloudText = await dlRes.text();
              const localEntries = parseDictLines(cached.rawText);
              const cloudEntries = parseDictLines(cloudText);
              
              const map = new Map<string, Set<string>>();
              const addToMap = (e: { chinese: string; vietnamese: string }) => {
                const key = e.chinese;
                const meanings = e.vietnamese.split("/").map(m => m.trim()).filter(Boolean);
                if (!map.has(key)) map.set(key, new Set());
                meanings.forEach(m => map.get(key)!.add(m));
              };
              cloudEntries.forEach(addToMap);
              localEntries.forEach(addToMap);
              
              finalContent = Array.from(map.entries())
                .map(([k, vs]) => `${k}=${Array.from(vs).join("/")}`)
                .join("\n");
            }

            try {
              const compressed = await compress(finalContent);
              const uploadParams = new URLSearchParams({ action: 'upload-dict', filename });
              const res = await fetch(`/api/dict/cloud-storage?${uploadParams.toString()}`, {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: compressed
              });

              if (res.ok) {
                successCount++;
              }
            } catch (err) {
              console.error(`Failed to upload ${filename}:`, err);
            }
          })
        );
        
        toast.loading(`Đang xử lý: ${Math.round((processedCount / total) * 100)}%...`, { id: toastId });
      }
      
      toast.success(`Đã hòa nhập xong ${successCount} bộ từ điển lên Tổng kho!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleDownloadAllFromWarehouse = async () => {
    const toastId = toast.loading("Đang tải toàn bộ từ Tổng kho...");
    try {
      const params = new URLSearchParams({ action: 'download-all-dicts' });
      const res = await fetch(`/api/dict/cloud-storage?${params.toString()}`, { method: 'POST' });
      if (!res.ok) throw new Error("Không thể kết nối đến Tổng kho");
      
      const data = await res.json();
      if (!data.success || !data.dicts) throw new Error("Dữ liệu trả về không hợp lệ");

      const allDicts: Record<string, string> = data.dicts;
      const total = Object.keys(allDicts).length;
      let newEntriesCount = 0;
      let processedCount = 0;

      // Import: saveDictSource for fast-replace when local is empty
      const { saveDictSource } = await import("@/lib/hooks/use-dict-entries");

      for (const [source, content] of Object.entries(allDicts)) {
        processedCount++;
        const pct = Math.round((processedCount / total) * 100);
        toast.loading(`Đang xử lý ${source} (${pct}%)...`, { id: toastId });

        if (!content || content.trim().length === 0) continue;

        // Check if local has data — if empty, use fast saveDictSource (no merge needed)
        const localCached = await db.dictCache.get(source as any);
        const localHasData = localCached?.rawText && localCached.rawText.trim().length > 0;

        if (!localHasData) {
          // Fast path: no local data, direct save (no merge overhead)
          await saveDictSource(source as any, content);
          const lineCount = content.split("\n").filter((l: string) => l.includes("=")).length;
          newEntriesCount += lineCount;
        } else {
          // Merge path: local has data, use appendToDictSource
          const entries = parseDictLines(content);
          if (entries.length > 0) {
            const result = await appendToDictSource(source as any, entries);
            if (typeof result === "object") {
              newEntriesCount += result.added || 0;
            }
          }
        }
        // Yield to main thread between sources
        await new Promise(r => setTimeout(r, 0));
      }
      
      toast.success(`Đã cập nhật ${newEntriesCount.toLocaleString()} mục mới từ Tổng kho!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };


  const handleUploadGlobalToDrive = async () => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước (Nút trên cùng)");
      return;
    }
    if (!globalEntries || globalEntries.length === 0) return;
    const toastId = toast.loading("Đang tải từ điển tên chung lên Drive...");
    try {
      const text = globalEntries.map((e) => `${e.chinese}=${e.vietnamese}`).join("\n");
      await drive.uploadFile("tu-dien-chung.txt", text);
      toast.success("Đã tải từ điển chung lên Google Drive!", { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleDownloadGlobalFromDrive = async () => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước (Nút trên cùng)");
      return;
    }
    const toastId = toast.loading("Đang tải từ điển chung từ Drive...");
    try {
      const text = await drive.downloadFile("tu-dien-chung.txt");
      if (!text) {
        toast.error("Không tìm thấy file tu-dien-chung.txt trên Drive", { id: toastId });
        return;
      }
      const entries = parseDictLines(text);
      if (entries.length === 0) {
        toast.error("File từ điển chung trên Drive trống hoặc không hợp lệ", { id: toastId });
        return;
      }
      toast.dismiss(toastId);
      openImportDialog(entries, `Drive: tu-dien-chung.txt (${entries.length.toLocaleString()} mục)`);
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleCleanJunk = async (source: DictSource) => {
    const cached = await db.dictCache.get(source);
    if (!cached?.rawText) return;

    const entries = parseDictLines(cached.rawText);
    const originalCount = entries.length;

    // Bộ lọc rác
    const cleaned = entries.filter(e => {
      const cn = e.chinese.trim();
      const vi = e.vietnamese.trim();
      if (cn.length <= 1) return false; // Quá ngắn
      if (cn.toLowerCase() === vi.toLowerCase()) return false; // Giống hệt
      if (cn.length > 15) return false; // Quá dài
      if (!/[\u4e00-\u9fa5]/.test(cn)) return false; // Không có chữ Trung
      return true;
    });

    const removedCount = originalCount - cleaned.length;
    if (removedCount === 0) {
      toast.info("Từ điển này đã rất sạch sẽ rồi!");
      return;
    }

    if (!confirm(`Hệ thống tìm thấy ${removedCount} mục rác (quá ngắn, quá dài hoặc dịch lỗi). Bạn có muốn xóa chúng không?`)) return;

    const text = cleaned.map(e => `${e.chinese}=${e.vietnamese}`).join("\n");
    await db.dictCache.put({ source, rawText: text });
    
    // Update meta (dictEntries bỏ qua — dictCache là nguồn chính)
    let meta = await db.dictMeta.get("dict-meta");
    if (!meta) {
      meta = { id: "dict-meta", loadedAt: new Date(), sources: {} as Record<DictSource, number> };
    }
    meta.sources[source] = cleaned.length;
    meta.loadedAt = new Date();
    await db.dictMeta.put(meta);

    toast.success(`Đã dọn dẹp xong! Loại bỏ ${removedCount} mục rác.`);
  };

  const handleCleanAllJunk = async () => {
    if (!confirm("Hệ thống sẽ quét TOÀN BỘ các bộ từ điển và xóa bỏ các mục rác (quá ngắn, quá dài, dịch lỗi). Bạn có chắc chắn muốn tổng vệ sinh không?")) return;
    
    const toastId = toast.loading("Đang tổng vệ sinh kho từ điển (0%)...");
    try {
      const sources = ALL_SOURCES;
      const total = sources.length;
      let totalRemoved = 0;
      let processed = 0;

      const CONCURRENCY = 10;
      for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = sources.slice(i, i + CONCURRENCY);
        
        await Promise.all(batch.map(async (source) => {
          const cached = await db.dictCache.get(source);
          if (!cached?.rawText) return;

          const entries = parseDictLines(cached.rawText);
          const cleaned = entries.filter(e => {
            const cn = e.chinese.trim();
            const vi = e.vietnamese.trim();
            if (cn.length <= 1) return false;
            if (cn.toLowerCase() === vi.toLowerCase()) return false;
            if (cn.length > 15) return false;
            if (!/[\u4e00-\u9fa5]/.test(cn)) return false;
            return true;
          });

          const removed = entries.length - cleaned.length;
          if (removed > 0) {
            totalRemoved += removed;
            const text = cleaned.map(e => `${e.chinese}=${e.vietnamese}`).join("\n");
            await db.dictCache.put({ source, rawText: text });

            // Update meta in DB
            let meta = await db.dictMeta.get("dict-meta");
            if (meta) {
              meta.sources[source] = cleaned.length;
              meta.loadedAt = new Date();
              await db.dictMeta.put(meta);
            }
          }
          processed++;
        }));

        toast.loading(`Đang vệ sinh: ${Math.round((processed / total) * 100)}%...`, { id: toastId });
      }

      toast.success(`Tổng vệ sinh hoàn tất! Đã loại bỏ tổng cộng ${totalRemoved.toLocaleString()} mục rác.`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi tổng vệ sinh: ${err.message}`, { id: toastId });
    }
  };

  const handleReplaceClick = (source: DictSource) => {
    setReplacingSource(source);
    // Trigger file input after state update
    setTimeout(() => replaceInputRef.current?.click(), 0);
  };



  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replacingSource) return;
    try {
      const count = await importDictFile(file, replacingSource);
      toast.success(
        `Đã thay thế ${DICT_SOURCE_LABELS[replacingSource]} với ${count.toLocaleString()} mục`,
      );
    } catch {
      toast.error("Lỗi khi nhập file");
    }
    setReplacingSource(null);
    if (replaceInputRef.current) replaceInputRef.current.value = "";
  };

  const handleAddEntry = async () => {
    if (!newChinese.trim() || !newVietnamese.trim()) return;
    await createNameEntry({
      scope: "global",
      chinese: newChinese.trim(),
      vietnamese: newVietnamese.trim(),
      category: newCategory,
    });
    setNewChinese("");
    setNewVietnamese("");
    setAddDialogOpen(false);
    toast.success("Đã thêm mục mới");
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry || !newChinese.trim() || !newVietnamese.trim()) return;
    await updateNameEntry(editingEntry.id, {
      chinese: newChinese.trim(),
      vietnamese: newVietnamese.trim(),
      category: newCategory,
    });
    setEditingEntry(null);
    toast.success("Đã cập nhật");
  };

  const handleDeleteEntry = async (id: string) => {
    await deleteNameEntry(id);
    toast.success("Đã xóa");
  };

  const handleClearGlobalNames = async () => {
    await deleteNameEntriesByScope("global");
    toast.success("Đã xóa tất cả tên chung");
  };

  const parseDictLines = (text: string) => {
    const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
    return clean
      .split(/\r?\n/)
      .map((line) => {
        const idx = line.indexOf("=");
        if (idx < 1) return null;
        return {
          chinese: line.slice(0, idx).trim(),
          vietnamese: line.slice(idx + 1).trim(),
        };
      })
      .filter(
        (e): e is { chinese: string; vietnamese: string } =>
          !!e && !!e.chinese && !!e.vietnamese,
      );
  };

  const openImportDialog = (
    entries: Array<{ chinese: string; vietnamese: string }>,
    label: string,
  ) => {
    setImportPending(entries);
    setImportSourceLabel(label);
    setImportCategory("nhân vật");
    setImportDuplicateMode("skip");
    setImportDialogOpen(true);
  };

  const handleImportFromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const entries = parseDictLines(text);
      if (entries.length === 0) {
        toast.error("File không hợp lệ (định dạng: 中文=tiếng việt)");
        return;
      }
      openImportDialog(
        entries,
        `${file.name} (${entries.length.toLocaleString()} mục)`,
      );
    };
    reader.readAsText(file);
    if (nameFileInputRef.current) nameFileInputRef.current.value = "";
  };

  const handleConfirmImport = async () => {
    if (!importPending) return;
    try {
      const result = await bulkImportNameEntries(
        "global",
        importPending,
        importCategory,
        importDuplicateMode,
      );
      const parts: string[] = [];
      if (result.added > 0) parts.push(`${result.added} mới`);
      if (result.replaced > 0) parts.push(`${result.replaced} cập nhật`);
      if (result.skipped > 0) parts.push(`${result.skipped} bỏ qua`);
      toast.success(`Đã nhập: ${parts.join(", ")}`);
    } catch {
      toast.error("Lỗi khi nhập dữ liệu");
    }
    setImportDialogOpen(false);
    setImportPending(null);
  };

  const handleImportQTNames = async () => {
    try {
      const [resp1, resp2] = await Promise.all([
        fetch("/dict/names.txt"),
        fetch("/dict/names2.txt"),
      ]);
      const [text1, text2] = await Promise.all([resp1.text(), resp2.text()]);

      const entries = [...parseDictLines(text1), ...parseDictLines(text2)];
      openImportDialog(
        entries,
        `QT Names (${entries.length.toLocaleString()} mục)`,
      );
    } catch {
      toast.error("Lỗi khi đọc file QT Names");
    }
  };

  const openEditDialog = (entry: NameEntry) => {
    setEditingEntry(entry);
    setNewChinese(entry.chinese);
    setNewVietnamese(entry.vietnamese);
    setNewCategory(entry.category);
  };

  // System Lookup logic
  const [lookupQuery, setLookupQuery] = useState("");
  const systemResults = useLiveQuery(async () => {
    if (!lookupQuery || lookupQuery.length < 1) return [];
    const caches = await db.dictCache.toArray();
    const results: Array<{ chinese: string, vietnamese: string, source: string }> = [];
    for (const c of caches) {
      if (!c.rawText) continue;
      const lines = c.rawText.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith(lookupQuery)) {
          const idx = line.indexOf("=");
          if (idx > 0) {
            const ch = line.slice(0, idx).trim();
            if (ch.startsWith(lookupQuery)) {
              results.push({ chinese: ch, vietnamese: line.slice(idx + 1).trim(), source: c.source });
            }
          }
        }
        if (results.length >= 50) return results;
      }
    }
    return results;
  }, [lookupQuery]);

  // Suggestions for currently editing/adding word
  const currentChinese = editingEntry ? newChinese : newChinese; // simplified
  const systemSuggestions = useLiveQuery(async () => {
    if (!newChinese) return [];
    const caches = await db.dictCache.toArray();
    const results: Array<{ chinese: string, vietnamese: string, source: string }> = [];
    const prefix = newChinese + "=";
    for (const c of caches) {
      if (!c.rawText) continue;
      const lines = c.rawText.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith(prefix)) {
          const idx = line.indexOf("=");
          if (idx > 0) {
            const ch = line.slice(0, idx).trim();
            if (ch === newChinese) {
              results.push({ chinese: ch, vietnamese: line.slice(idx + 1).trim(), source: c.source });
            }
          }
        }
      }
    }
    return results;
  }, [newChinese]);

  // Paginate
  const PAGE_SIZE = compact ? 20 : 10;
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(filteredEntries.length / PAGE_SIZE);
  const pagedEntries = filteredEntries.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );

  if (compact) {
    return (
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b pb-1 mb-2">
           <button 
             onClick={() => setActiveTab("list")}
             className={cn(
               "px-3 py-1 text-[10px] font-bold uppercase transition-colors rounded-t-md",
               activeTab === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
             )}
           >
             Của tôi
           </button>
           <button 
             onClick={() => setActiveTab("lookup")}
             className={cn(
               "px-3 py-1 text-[10px] font-bold uppercase transition-colors rounded-t-md",
               activeTab === "lookup" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
             )}
           >
             Tra hệ thống
           </button>
        </div>

        {activeTab === "list" ? (
          <>
            {/* Search & filter tags */}
            <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <SearchIcon className="text-muted-foreground absolute top-2.5 left-2.5 size-3.5" />
                    <Input
                      placeholder="Tìm trong từ điển của bạn..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setPage(0);
                      }}
                      className="pl-8 h-9 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-9 px-3"
                    onClick={() => {
                      setNewChinese("");
                      setNewVietnamese("");
                      setNewCategory("nhân vật");
                      setAddDialogOpen(true);
                    }}
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                </div>

                {/* Filter Tags */}
                <div className="space-y-3 rounded-md border bg-muted/20 p-2.5">
                  <div className="space-y-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Phạm vi</p>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { id: "all", label: "Tất cả" },
                        { id: "local", label: "Riêng" },
                        { id: "global", label: "Chung" },
                      ].map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setScopeFilter(s.id as any)}
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors border",
                            scopeFilter === s.id
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-muted border-border"
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Loại</p>
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => setCategoryFilter("all")}
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors border",
                          categoryFilter === "all"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted border-border"
                        )}
                      >
                        Tất cả
                      </button>
                      {NAME_ENTRY_CATEGORIES.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setCategoryFilter(cat)}
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors border capitalize",
                            categoryFilter === cat
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-muted border-border"
                          )}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
            </div>

            {/* Compact List */}
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {pagedEntries.map((entry) => (
                <div key={entry.id} className="group flex items-center justify-between rounded-md border border-border/50 p-2 hover:bg-muted/30">
                   <div className="min-w-0 flex-1">
                     <div className="flex items-center gap-1.5">
                       <span className="font-mono text-xs font-bold text-primary">{entry.chinese}</span>
                       <span className="text-[10px] text-muted-foreground">→</span>
                       <span className="text-xs font-medium">{entry.vietnamese}</span>
                     </div>
                     <div className="mt-0.5">
                       <Badge variant="outline" className="h-4 px-1 text-[8px] uppercase tracking-tighter opacity-60">
                         {entry.category}
                       </Badge>
                     </div>
                   </div>
                   <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="icon-xs" onClick={() => openEditDialog(entry)}>
                        <Edit3 className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => handleDeleteEntry(entry.id)}>
                        <Trash2Icon className="size-3" />
                      </Button>
                   </div>
                </div>
              ))}
              
              {filteredEntries.length === 0 && (
                 <p className="py-8 text-center text-[10px] text-muted-foreground italic">Không tìm thấy kết quả</p>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
             <div className="relative">
                <SearchIcon className="text-muted-foreground absolute top-2.5 left-2.5 size-3.5" />
                <Input
                  placeholder="Tra cứu từ điển hệ thống (Vietphrase/Hán Việt)..."
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  className="pl-8 h-9 text-xs"
                />
             </div>
             <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
                {systemResults?.map((res, i) => (
                   <div key={i} className="flex flex-col rounded-md border p-2 bg-muted/10">
                      <div className="flex items-center justify-between">
                         <span className="font-mono text-xs font-bold">{res.chinese}</span>
                         <Badge variant="secondary" className="text-[8px] h-4">{res.source}</Badge>
                      </div>
                      <p className="text-xs mt-1 text-primary">{res.vietnamese}</p>
                      <Button 
                        variant="ghost" 
                        size="xs" 
                        className="mt-2 h-6 text-[9px] uppercase font-bold self-end"
                        onClick={() => {
                           setNewChinese(res.chinese);
                           setNewVietnamese(res.vietnamese.split("/")[0]);
                           setAddDialogOpen(true);
                           setActiveTab("list");
                        }}
                      >
                         Dùng nghĩa này
                      </Button>
                   </div>
                ))}
                {lookupQuery && systemResults?.length === 0 && (
                   <p className="text-center py-10 text-[10px] text-muted-foreground">Không tìm thấy từ này trong hệ thống</p>
                )}
             </div>
          </div>
        )}

        {/* Dialogs */}
        <Dialog
          open={addDialogOpen || !!editingEntry}
          onOpenChange={(open) => {
            if (!open) {
              setAddDialogOpen(false);
              setEditingEntry(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-sm">
                {editingEntry ? "Sửa từ điển" : "Thêm từ mới"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-[10px]">Trung văn</Label>
                <Input value={newChinese} onChange={(e) => setNewChinese(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Tiếng Việt</Label>
                <Input value={newVietnamese} onChange={(e) => setNewVietnamese(e.target.value)} className="h-8 text-xs" />
              </div>
              
              {/* Gợi ý hệ thống */}
              {systemSuggestions && systemSuggestions.length > 0 && (
                 <div className="space-y-1">
                    <Label className="text-[9px] text-muted-foreground">Gợi ý từ hệ thống:</Label>
                    <div className="flex flex-wrap gap-1">
                       {systemSuggestions.map((s, i) => (
                          <button 
                            key={i} 
                            onClick={() => setNewVietnamese(s.vietnamese.split("/")[0])}
                            className="px-1.5 py-0.5 rounded border text-[9px] bg-muted/50 hover:bg-primary/10 transition-colors"
                          >
                             {s.vietnamese}
                          </button>
                       ))}
                    </div>
                 </div>
              )}

              <div className="space-y-1">
                <Label className="text-[10px]">Loại</Label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className="h-8 text-xs capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NAME_ENTRY_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat} className="text-xs capitalize">{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button size="sm" onClick={editingEntry ? handleUpdateEntry : handleAddEntry}>Lưu</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }


  const totalDictWords = useMemo(() => {
    if (!dictMeta) return 0;
    return Object.values(dictMeta.sources).reduce((acc, curr) => acc + curr, 0);
  }, [dictMeta]);

  return (
    <div className="space-y-4">
      {/* Hidden file inputs */}
      <input
        type="file"
        accept=".txt"
        ref={replaceInputRef}
        className="hidden"
        onChange={handleReplaceFile}
      />
      <input
        type="file"
        accept=".txt"
        ref={nameFileInputRef}
        className="hidden"
        onChange={handleImportFromFile}
      />

      {/* Dict Status — per source breakdown */}
      <Card>
        <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Danh sách từ điển
                  {totalDictWords > 0 && (
                    <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20">
                      Tổng: {totalDictWords.toLocaleString()} mục
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Quản lý và đồng bộ các bộ từ điển cá nhân và cộng đồng.
                </CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadAllFromWarehouse}
                    className="h-8 text-[11px] font-medium border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 dark:border-emerald-500/20"
                  >
                    <CloudDownloadIcon className="mr-1.5 size-3.5" />
                    Cập nhật tất cả (Kho 1TB)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCleanAllJunk}
                    className="h-8 text-[11px] font-medium border-orange-500/30 text-orange-600 hover:bg-orange-500/10 dark:border-orange-500/20"
                  >
                    <Trash2Icon className="mr-1.5 size-3.5" />
                    Tổng vệ sinh rác
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncAllToWarehouse}
                    className="h-8 text-[11px] font-medium border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 dark:border-emerald-500/20"
                  >
                    <CloudUploadIcon className="mr-1.5 size-3.5" />
                    Đóng góp tất cả
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
        <CardContent>
          <Tabs defaultValue="core" className="w-full">
            <div className="overflow-x-auto pb-2">
              <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground w-auto flex-nowrap">
                {DICT_GENRES.map((genre) => (
                  <TabsTrigger key={genre} value={genre} className="whitespace-nowrap px-3 text-xs">
                    {GENRE_LABELS[genre]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            
            {DICT_GENRES.map((genre) => (
              <TabsContent key={genre} value={genre} className="mt-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[200px]">Loại từ điển</TableHead>
                        <TableHead>Mô tả</TableHead>
                        <TableHead className="text-right">Số mục</TableHead>
                        <TableHead className="w-[100px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {DICT_TYPES.filter((type) => 
                        (genre === "core" && (type === "vietphrase" || type === "phienam")) ||
                        (genre !== "core")
                      ).map((type) => {
                        const source = `${genre}_${type}` as DictSource;
                        const count = dictMeta?.sources[source] ?? 0;
                        return (
                          <TableRow key={source}>
                            <TableCell className="font-medium text-xs">
                              {source === "core_vietphrase" ? "Từ Điển Chính (Phụ trợ)" : 
                               source === "core_phienam" ? "Phiên âm (Phụ trợ)" : TYPE_LABELS[type]}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-[10px]">
                              {source}
                            </TableCell>
                            <TableCell className="text-right">
                              {count > 0 ? (
                                <Badge variant="secondary">{count.toLocaleString()}</Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground">0</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => handleDownloadFromWarehouse(source)}
                                      title="Cập nhật từ Kho chung (Tổng kho 1TB)"
                                      className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                                    >
                                      <CloudDownloadIcon className="size-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => handleSyncToWarehouse(source)}
                                      disabled={count === 0}
                                      title="Đóng góp vào Kho chung (Hòa nhập thông minh)"
                                      className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                                    >
                                      <CloudUploadIcon className="size-3.5" />
                                    </Button>
                                    <div className="w-px h-4 bg-border my-auto mx-1" />
                                  </>

                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleSyncToLocalCode(source)}
                                  disabled={count === 0}
                                  title="Lưu thẳng vào thư mục public/dict"
                                  className="text-amber-500 hover:text-amber-600"
                                >
                                  <SaveIcon className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleCleanJunk(source)}
                                  title="Dọn rác (Xóa từ lỗi, từ quá ngắn/dài)"
                                  className="text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
                                >
                                  <Trash2Icon className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleDownload(source)}
                                  disabled={count === 0}
                                  title="Tải xuống máy"
                                >
                                  <DownloadIcon className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleReplaceClick(source)}
                                  title="Tải lên từ máy"
                                >
                                  <FileUpIcon className="size-3.5" />
                                </Button>

                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>


      {/* Global Name Entries has been removed by request */}

      {/* Add/Edit Dialog */}
      <Dialog
        open={addDialogOpen || !!editingEntry}
        onOpenChange={(open) => {
          if (!open) {
            setAddDialogOpen(false);
            setEditingEntry(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? "Chỉnh sửa mục" : "Thêm mục mới"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Trung văn</Label>
              <Input
                value={newChinese}
                onChange={(e) => setNewChinese(e.target.value)}
                placeholder="林枫"
              />
            </div>
            <div className="space-y-1">
              <Label>Tiếng Việt</Label>
              <Input
                value={newVietnamese}
                onChange={(e) => setNewVietnamese(e.target.value)}
                placeholder="Lâm Phong"
              />
            </div>
            <div className="space-y-1">
              <Label>Loại</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="w-full capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NAME_ENTRY_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} className="capitalize">
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false);
                setEditingEntry(null);
              }}
            >
              Hủy
            </Button>
            <Button
              onClick={editingEntry ? handleUpdateEntry : handleAddEntry}
              disabled={!newChinese.trim() || !newVietnamese.trim()}
            >
              {editingEntry ? "Lưu" : "Thêm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Confirmation Dialog */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setImportDialogOpen(false);
            setImportPending(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nhập từ điển tên</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-muted-foreground text-sm">
              Nguồn:{" "}
              <span className="text-foreground font-medium">
                {importSourceLabel}
              </span>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Loại mặc định</Label>
              <Select value={importCategory} onValueChange={setImportCategory}>
                <SelectTrigger className="w-full capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NAME_ENTRY_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} className="capitalize">
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Xử lý trùng lặp</Label>
              <div className="flex gap-2">
                <Button
                  variant={
                    importDuplicateMode === "skip" ? "default" : "outline"
                  }
                  size="sm"
                  className="flex-1"
                  onClick={() => setImportDuplicateMode("skip")}
                >
                  Giữ bản cũ
                </Button>
                <Button
                  variant={
                    importDuplicateMode === "replace" ? "default" : "outline"
                  }
                  size="sm"
                  className="flex-1"
                  onClick={() => setImportDuplicateMode("replace")}
                >
                  Ghi đè bản mới
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                {importDuplicateMode === "skip"
                  ? "Bỏ qua các mục đã tồn tại (giữ nguyên bản dịch cũ)"
                  : "Cập nhật bản dịch mới cho các mục đã tồn tại"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportDialogOpen(false);
                setImportPending(null);
              }}
            >
              Hủy
            </Button>
            <Button onClick={handleConfirmImport}>
              Nhập {importPending?.length.toLocaleString()} mục
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
