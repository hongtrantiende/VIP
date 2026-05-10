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
  type DictSource,
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
} from "lucide-react";
import { useGoogleDrive } from "@/lib/hooks/use-google-drive";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";

const ALL_SOURCES: DictSource[] = [
  "vietphrase",
  "names",
  "names2",
  "phienam",
  "luatnhan",
  "ngontinh",
  "hiendai",
  "tienhiep",
  "huyenhuyen",
  "dammi",
  "hocduong",
  "nsfw",
  "hentai",
];

const DICT_SOURCE_LABELS: Record<DictSource, string> = {
  vietphrase: "VietPhrase",
  names: "Names",
  names2: "Names2",
  phienam: "Phiên âm",
  luatnhan: "Luật nhân",
  ngontinh: "Ngôn tình",
  hiendai: "Hiện đại",
  tienhiep: "Tiên hiệp",
  huyenhuyen: "Huyền huyễn",
  dammi: "Đam mỹ",
  hocduong: "Học đường",
  nsfw: "NSFW",
  hentai: "Hentai",
  dongphuong: "Đông phương",
  dothi: "Đô thị",
  vongdu: "Võng du",
  khoahuyen: "Khoa huyễn",
  quybi: "Quỷ bí / Linh dị",
  xuyenkhong: "Xuyên không",
  hethong: "Hệ thống",
  trinhtham: "Trinh thám",
  lichsu: "Lịch sử",
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

const DICT_SOURCE_DESC: Record<DictSource, string> = {
  vietphrase: "Từ điển chính Hán-Việt",
  names: "Tên nhân vật, địa danh",
  names2: "Tên bổ sung",
  phienam: "Phiên âm ký tự đơn",
  luatnhan: "Luật nhân xưng {0}",
  ngontinh: "Từ vựng ngôn tình",
  hiendai: "Từ vựng hiện đại",
  tienhiep: "Tu chân, tu tiên",
  huyenhuyen: "Kỳ ảo, ma pháp",
  dammi: "Đam mỹ, bách hợp",
  hocduong: "Vườn trường",
  nsfw: "Từ ngữ nhạy cảm (18+)",
  hentai: "Thể loại người lớn",
  dongphuong: "Tiên hiệp phương Đông",
  dothi: "Bối cảnh hiện đại đô thị",
  vongdu: "Game thực tế ảo",
  khoahuyen: "Khoa học viễn tưởng",
  quybi: "Tâm linh, kinh dị",
  xuyenkhong: "Xuyên không, trọng sinh",
  hethong: "Hệ thống phụ trợ",
  trinhtham: "Phá án, suy luận",
  lichsu: "Dã sử, quân sự",
};

export function DictionaryManagement({ compact }: { compact?: boolean }) {
  const drive = useGoogleDrive();
  const dictMeta = useDictMeta();
  const globalEntries = useGlobalNameEntries();
  const [isReloading, setIsReloading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email === "nthanhnam2005@gmail.com") {
        setIsAdmin(true);
      }
    });
  }, []);
  const [replacingSource, setReplacingSource] = useState<DictSource | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<"list" | "lookup">("list");
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
      const records = await db.dictEntries.where("source").equals(source).toArray();
      const text = records.map(r => `${r.chinese}=${r.vietnamese}`).join("\n");
      
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
      const records = await db.dictEntries.where("source").equals(source).toArray();
      const text = records.map(r => `${r.chinese}=${r.vietnamese}`).join("\n");
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

  const handleUploadToSupabase = async (source: DictSource) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Vui lòng đăng nhập để lưu lên đám mây");
      return;
    }
    const toastId = toast.loading(`Đang tải ${DICT_SOURCE_LABELS[source]} lên Kho chung...`);
    try {
      const records = await db.dictEntries.where("source").equals(source).toArray();
      const text = records.map(r => `${r.chinese}=${r.vietnamese}`).join("\n");
      const filename = `${source}.txt`;
      
      const { error } = await supabase.storage
        .from("dictionaries")
        .upload(filename, text, {
          contentType: 'text/plain;charset=UTF-8',
          upsert: true,
        });

      if (error) throw error;
      toast.success(`Đã lưu ${filename} lên Kho chung!`, { id: toastId });
    } catch (err: any) {
      toast.error(`Lỗi: ${err.message}`, { id: toastId });
    }
  };

  const handleDownloadFromSupabase = async (source: DictSource) => {
    const supabase = createClient();
    const filename = `${source}.txt`;
    const toastId = toast.loading(`Đang tải ${filename} từ Kho chung...`);
    try {
      const { data: publicUrlData } = supabase.storage
        .from("dictionaries")
        .getPublicUrl(filename);
      
      const res = await fetch(`${publicUrlData.publicUrl}?t=${Date.now()}`, { cache: "no-store" });

      if (!res.ok) {
        toast.error(`Từ điển ${filename} chưa có trên Kho chung!`, { id: toastId });
        return;
      }
      
      const text = await res.text();
      const entries = parseDictLines(text);
      const count = await appendToDictSource(source, entries);
      toast.success(`Đã tự động gộp ${count.toLocaleString()} mục mới từ Kho chung cho ${DICT_SOURCE_LABELS[source]}`, { id: toastId });
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
    return db.dictEntries
      .where("chinese")
      .startsWith(lookupQuery)
      .limit(50)
      .toArray();
  }, [lookupQuery]);

  // Suggestions for currently editing/adding word
  const currentChinese = editingEntry ? newChinese : newChinese; // simplified
  const systemSuggestions = useLiveQuery(async () => {
    if (!newChinese) return [];
    return db.dictEntries
      .where("chinese")
      .equals(newChinese)
      .toArray();
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
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookTextIcon className="size-4" />
                Từ điển QT
              </CardTitle>
              <CardDescription>
                {dictMeta
                  ? `Cập nhật ${formatRelativeTime(new Date(dictMeta.loadedAt))}`
                  : "Chưa tải"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReloadDicts}
                disabled={isReloading}
              >
                <RefreshCwIcon className="mr-2 size-3.5" />
                {isReloading ? "Đang tải..." : "Tải lại tất cả"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nguồn</TableHead>
                  <TableHead>Mô tả</TableHead>
                  <TableHead className="text-right">Số mục</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ALL_SOURCES.map((source) => {
                  const count = dictMeta?.sources[source] ?? 0;
                  return (
                    <TableRow key={source}>
                      <TableCell className="font-medium">
                        {DICT_SOURCE_LABELS[source]}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {DICT_SOURCE_DESC[source]}
                      </TableCell>
                      <TableCell className="text-right">
                        {count > 0 ? (
                          <Badge variant="secondary">
                            {count.toLocaleString()}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            0
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDownloadFromSupabase(source)}
                            title={`Cập nhật từ điển mới nhất`}
                            className="text-violet-500 hover:text-violet-600"
                          >
                            <ServerIcon className="size-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleUploadToSupabase(source)}
                              disabled={count === 0}
                              title={`Tải ${DICT_SOURCE_LABELS[source]} lên Kho chung (Admin)`}
                              className="text-violet-500 hover:text-violet-600"
                            >
                              <ServerIcon className="size-3.5" />
                            </Button>
                          )}
                          <div className="w-px h-4 bg-border my-auto mx-1" />
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleSyncToLocalCode(source)}
                              disabled={count === 0}
                              title={`Lưu thẳng vào thư mục public/dict/${source}.txt (Chỉ Admin)`}
                              className="text-amber-500 hover:text-amber-600"
                            >
                              <SaveIcon className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDownload(source)}
                            disabled={count === 0}
                            title={`Tải xuống máy ${DICT_SOURCE_LABELS[source]}`}
                          >
                            <DownloadIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleReplaceClick(source)}
                            title={`Tải lên máy ${DICT_SOURCE_LABELS[source]}`}
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
        </CardContent>
      </Card>

      {/* Global Name Entries */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Từ điển tên chung</CardTitle>
              <CardDescription>
                {(globalEntries ?? []).length.toLocaleString()} mục
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!globalEntries || globalEntries.length === 0) return;
                  const text = globalEntries
                    .map((e) => `${e.chinese}=${e.vietnamese}`)
                    .join("\n");
                  const blob = new Blob([text], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `tu-dien-chung-${new Date().toISOString().slice(0, 10)}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <DownloadIcon className="mr-2 size-3.5" />
                Xuất file .txt
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportQTNames}>
                <DownloadIcon className="mr-2 size-3.5" />
                Nhập QT Names
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => nameFileInputRef.current?.click()}
              >
                <FileUpIcon className="mr-2 size-3.5" />
                Nhập từ file
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setNewChinese("");
                  setNewVietnamese("");
                  setNewCategory("nhân vật");
                  setAddDialogOpen(true);
                }}
              >
                <PlusIcon className="mr-2 size-3.5" />
                Thêm
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Search & filter */}
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="text-muted-foreground absolute top-2.5 left-2.5 size-3.5" />
                <Input
                  placeholder="Tìm kiếm..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(0);
                  }}
                  className="pl-8 h-9"
                />
              </div>
              {(globalEntries ?? []).length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleClearGlobalNames}
                  title="Xóa tất cả"
                  className="h-9 w-9"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </div>

            {/* Filter Tags as requested in screenshot */}
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Phạm vi</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "all", label: "Tất cả" },
                    { id: "local", label: "Riêng" },
                    { id: "global", label: "Chung" },
                  ].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setScopeFilter(s.id as any)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors border",
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
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Loại</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setCategoryFilter("all")}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors border",
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
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors border capitalize",
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

          {/* Table */}
          {pagedEntries.length > 0 ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[30%]">Trung</TableHead>
                      <TableHead className="w-[35%]">Việt</TableHead>
                      <TableHead className="w-[20%]">Loại</TableHead>
                      <TableHead className="w-[15%]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono text-sm">
                          {entry.chinese}
                        </TableCell>
                        <TableCell>{entry.vietnamese}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-xs capitalize"
                          >
                            {entry.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openEditDialog(entry)}
                            >
                              <Edit3 className="size-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleDeleteEntry(entry.id)}
                            >
                              <Trash2Icon className="size-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm w-[180px]">
                    Trang {page + 1}/{totalPages} ({filteredEntries.length} mục)
                  </span>
                  <Pagination className="flex-1 justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          text="Trước"
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          aria-disabled={page === 0}
                          className={
                            page === 0
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                        />
                      </PaginationItem>

                      {getPageRange(page, totalPages).map((p, i) =>
                        p === "ellipsis" ? (
                          <PaginationItem key={`e${i}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={p}>
                            <PaginationLink
                              isActive={p === page}
                              onClick={() => setPage(p)}
                              className="cursor-pointer"
                            >
                              {p + 1}
                            </PaginationLink>
                          </PaginationItem>
                        ),
                      )}

                      <PaginationItem>
                        <PaginationNext
                          text="Sau"
                          onClick={() =>
                            setPage((p) => Math.min(totalPages - 1, p + 1))
                          }
                          aria-disabled={page >= totalPages - 1}
                          className={
                            page >= totalPages - 1
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
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {searchQuery || categoryFilter !== "all"
                ? "Không tìm thấy kết quả"
                : 'Chưa có mục nào. Nhấn "Thêm mục" hoặc "Nhập từ QT Names" để bắt đầu.'}
            </p>
          )}
        </CardContent>
      </Card>

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
