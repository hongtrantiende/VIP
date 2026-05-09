"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { DatabaseIcon } from "lucide-react";
import { useNovels } from "@/lib/hooks";
import { useGoogleDrive } from "@/lib/hooks/use-google-drive";
import { CloudIcon, CloudDownloadIcon, CloudUploadIcon } from "lucide-react";
import {
  buildExportPayload,
  exportDatabase,
  previewImportFile,
  importDatabase,
  getStorageStats,
  type StorageStats,
  type ProgressInfo,
  type ConflictMode,
  type ImportPreview
} from "@/lib/db-io";
import { ProgressDialog } from "@/components/progress-dialog";
import { DictionaryManagement } from "@/components/dictionary-management";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DataSettingsTabs } from "@/components/data-settings/data-settings-tabs";
import { StorageStatsCard } from "@/components/data-settings/storage-stats-card";
import { ExportSettingsCard } from "@/components/data-settings/export-settings-card";
import { ImportSettingsCard } from "@/components/data-settings/import-settings-card";
import { PasswordGate } from "@/components/password-gate";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function DataSettings() {
  const novels = useNovels();
  const drive = useGoogleDrive();

  // Storage stats
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("stats");

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await getStorageStats());
    } catch {
      // ignore
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Export state
  const [selectedNovelIds, setSelectedNovelIds] = useState<string[]>([]);
  const [includeAI, setIncludeAI] = useState(true);
  const [includeConversations, setIncludeConversations] = useState(true);
  const [exportPassword, setExportPassword] = useState("");

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [conflictMode, setConflictMode] = useState<ConflictMode>("overwrite");
  const [importPassword, setImportPassword] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  // Progress state
  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileSizeWarning = importFile
    ? importFile.size > 10 * 1024 * 1024
    : false;

  // ─── Export ─────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(null);
    setResult(null);
    setProgressOpen(true);

    try {
      await exportDatabase({
        novelIds: selectedNovelIds.length > 0 ? selectedNovelIds : undefined,
        includeAISettings: includeAI,
        includeConversations,
        password: exportPassword || undefined,
        signal: ac.signal,
        onProgress: setProgress,
      });
      setResult({ success: true, message: "Xuất dữ liệu thành công!" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setResult({ success: false, message: "Đã huỷ xuất dữ liệu." });
      } else {
        setResult({
          success: false,
          message: err instanceof Error ? err.message : "Lỗi không xác định.",
        });
      }
    }
  }, [selectedNovelIds, includeAI, includeConversations, exportPassword]);


  // ─── Import file handling ─────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setImportFile(file);
    setImportPreview(null);
    setNeedsPassword(false);
    setImportPassword("");

    try {
      const preview = await previewImportFile(file);
      setImportPreview(preview);
    } catch (err) {
      if (err instanceof Error && err.message === "ENCRYPTED") {
        setNeedsPassword(true);
      } else {
        toast.error(err instanceof Error ? err.message : "Không thể đọc tệp.");
        setImportFile(null);
      }
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.name.endsWith(".json")) {
        toast.error("Chỉ chấp nhận tệp JSON.");
        return;
      }
      processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      processFile(file);
    },
    [processFile],
  );

  const handleDecryptAndPreview = useCallback(async () => {
    if (!importFile || !importPassword) return;
    try {
      const preview = await previewImportFile(importFile, importPassword);
      setImportPreview(preview);
      setNeedsPassword(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Không thể giải mã tệp.",
      );
    }
  }, [importFile, importPassword]);

  // ─── Drive Sync ──────────────────────────────────────────

  const handleBackupToDrive = useCallback(async () => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước.");
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
        novelIds: selectedNovelIds.length > 0 ? selectedNovelIds : undefined,
        includeAISettings: includeAI,
        includeConversations,
        includeLargeDictionaryData: false, // Bỏ qua từ điển
        password: exportPassword || undefined,
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
  }, [drive, selectedNovelIds, includeAI, includeConversations, exportPassword]);

  const handleRestoreFromDrive = useCallback(async () => {
    if (!drive.accessToken) {
      toast.error("Vui lòng kết nối Google Drive trước.");
      return;
    }
    
    const toastId = toast.loading("Đang tìm và tải bản sao lưu từ Drive...");
    try {
      const targetFilename = "novel-studio-library-backup.json";
      
      const text = await drive.downloadFile(targetFilename);
      if (!text) {
        toast.error(`Không tìm thấy bản sao lưu nào trên Drive. Vui lòng sao lưu trước!`, { id: toastId });
        return;
      }
      
      const file = new File([text], targetFilename, { type: "application/json" });
      toast.success("Đã tải tệp về, chuẩn bị phục hồi...", { id: toastId });
      processFile(file);
      setActiveTab("import");
    } catch (err: any) {
      toast.error(`Lỗi tải từ Drive: ${err.message}`, { id: toastId });
    }
  }, [drive, processFile]);

  // ─── Import ─────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!importFile) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(null);
    setResult(null);
    setProgressOpen(true);

    try {
      await importDatabase(
        importFile,
        { conflictMode, signal: ac.signal, onProgress: setProgress },
        importPassword || undefined,
      );
      setResult({ success: true, message: "Nhập dữ liệu thành công!" });
      loadStats();
      // Reset import state
      setImportFile(null);
      setImportPreview(null);
      setNeedsPassword(false);
      setImportPassword("");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setResult({ success: false, message: "Đã huỷ nhập dữ liệu." });
      } else {
        setResult({
          success: false,
          message: err instanceof Error ? err.message : "Lỗi không xác định.",
        });
      }
    }
  }, [importFile, conflictMode, importPassword, loadStats]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleCloseProgress = useCallback(() => {
    setProgressOpen(false);
    setResult(null);
    setProgress(null);
  }, []);

  // ─── Novel selection helpers ────────────────────────────

  const toggleNovel = useCallback((novelId: string, checked: boolean) => {
    setSelectedNovelIds((prev) =>
      checked ? [...prev, novelId] : prev.filter((id) => id !== novelId),
    );
  }, []);

  // ─── Render ─────────────────────────────────────────────

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <DatabaseIcon className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-tight">
                Quản lý dữ liệu
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Xuất, nhập và đồng bộ dữ liệu ứng dụng dưới dạng tệp JSON.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!drive.accessToken ? (
              <button
                onClick={drive.login}
                disabled={!drive.isReady}
                className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
              >
                <CloudIcon className="size-4" />
                Kết nối Drive
              </button>
            ) : (
              <>
                <button
                  onClick={drive.logout}
                  className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400 dark:hover:bg-emerald-900"
                >
                  <CloudIcon className="size-4" />
                  Đã kết nối Drive
                </button>
                <button
                  onClick={handleBackupToDrive}
                  className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  title="Đóng gói toàn bộ Thư viện hiện tại tải lên Google Drive"
                >
                  <CloudUploadIcon className="size-4 text-blue-500" />
                  Sao lưu lên Drive
                </button>
                <button
                  onClick={handleRestoreFromDrive}
                  className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  title="Tìm file sao lưu trên Drive và tải về máy"
                >
                  <CloudDownloadIcon className="size-4 text-emerald-500" />
                  Phục hồi từ Drive
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <DataSettingsTabs activeTab={activeTab} />
        <TabsContent value="stats">
          <StorageStatsCard
            stats={stats}
            statsLoading={statsLoading}
            formatFileSize={formatFileSize}
          />
        </TabsContent>

        <TabsContent value="export">
          <ExportSettingsCard
            novels={novels}
            selectedNovelIds={selectedNovelIds}
            exportPassword={exportPassword}
            onToggleNovel={toggleNovel}
            onExportPasswordChange={setExportPassword}
            onExport={handleExport}
          />
        </TabsContent>

        <TabsContent value="import">
          <ImportSettingsCard
            importFile={importFile}
            importPreview={importPreview}
            conflictMode={conflictMode}
            importPassword={importPassword}
            dragActive={dragActive}
            needsPassword={needsPassword}
            fileSizeWarning={fileSizeWarning}
            fileInputRef={fileInputRef}
            formatFileSize={formatFileSize}
            onDragActiveChange={setDragActive}
            onDrop={handleDrop}
            onFileSelect={handleFileSelect}
            onImportPasswordChange={setImportPassword}
            onDecryptAndPreview={handleDecryptAndPreview}
            onConflictModeChange={setConflictMode}
            onImport={handleImport}
          />
        </TabsContent>

        <TabsContent value="dictionary">
          <PasswordGate>
            <DictionaryManagement />
          </PasswordGate>
        </TabsContent>
      </Tabs>
      {/* ─── Progress Dialog ──────────────────────────────── */}
      <ProgressDialog
        open={progressOpen}
        title={
          progress?.phase === "export"
            ? "Đang xuất dữ liệu..."
            : "Đang nhập dữ liệu..."
        }
        progress={progress}
        result={result}
        onCancel={handleCancel}
        onClose={handleCloseProgress}
      />
    </main>
  );
}
