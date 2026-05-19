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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { countWords, stripHtml, isLocalhost } from "@/lib/utils";
import {
  CHAPTER_PRESETS,
  parseCustomRegex,
  splitChapters,
  splitByLength,
  testPattern,
  type ChapterCandidate,
} from "@/lib/import";
import {
  CheckIcon,
  CrownIcon,
  EyeIcon,
  FileTextIcon,
  PencilIcon,
  SettingsIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
  SparklesIcon,
  Loader2Icon,
  ChevronDownIcon,
} from "lucide-react";
import { useAIProviders, useAIModels } from "@/lib/hooks/use-ai-providers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";


// ─── Types ──────────────────────────────────────────────────

type Step = "input" | "configure" | "preview" | "confirm";

const STEPS: { key: Step; label: string; icon: React.ElementType }[] = [
  { key: "input", label: "Nhập liệu", icon: UploadIcon },
  { key: "configure", label: "Cấu hình", icon: SettingsIcon },
  { key: "preview", label: "Xem trước", icon: EyeIcon },
  { key: "confirm", label: "Xác nhận", icon: CheckIcon },
];

// ─── Component ──────────────────────────────────────────────

export function NovelImportWizard() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const providers = useAIProviders();
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>();

  const models = useAIModels(selectedProviderId);

  useEffect(() => {
    if (!selectedProviderId && providers && providers.length > 0) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    if (models && models.length > 0) {
      if (!selectedModelId || !models.some((m: any) => m.id === selectedModelId)) {
        setSelectedModelId(models[0].modelId || models[0].id);
      }
    } else {
      setSelectedModelId(undefined);
    }
  }, [models, selectedProviderId]);

  const targetProvider = providers?.find((p) => p.id === selectedProviderId);

  // Wizard state

  // Wizard state
  const fullTextRef = useRef("");
  const [step, setStep] = useState<Step>("input");
  const [inputMode, setInputMode] = useState<"paste" | "file">("paste");
  const [pasteText, setPasteText] = useState("");
  const [fileInfo, setFileInfo] = useState<{
    name: string;
    previewLines: string;
    wordCount: number;
    charCount: number;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [hasText, setHasText] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>("vietnamese");
  const [customRegex, setCustomRegex] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [splitMode, setSplitMode] = useState<"regex" | "length">("regex");
  const [chunkSize, setChunkSize] = useState(9000);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [chapters, setChapters] = useState<ChapterCandidate[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [novelTitle, setNovelTitle] = useState("");
  const [novelDescription, setNovelDescription] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isDetectingRegex, setIsDetectingRegex] = useState(false);

  const autoDetectRegex = async () => {
    setIsDetectingRegex(true);
    setMatchCount(null);
    try {
      const res = await fetch("/api/import/detect-regex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleText: fullTextRef.current.substring(0, 3000),
          provider: targetProvider,
          modelId: selectedModelId
        }),
      });
      const data = await res.json();
      if (data.success && data.regex) {
        setCustomRegex(data.regex);
        setUseCustom(true);
        toast.success("AI đã tìm thấy mẫu chương phù hợp!");
      } else {
        toast.error(data.error || "Không thể phân tích định dạng chương");
      }
    } catch (err: any) {
      toast.error("Lỗi kết nối AI: " + err.message);
    } finally {
      setIsDetectingRegex(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);



  // ── File Upload ─────────────────────────────────────────

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadProgress(0);
      setInputMode("file");
      setPasteText("");

      // Smart encoding: try UTF-8, fallback to GBK/Big5 for Chinese TXT files
      setUploadProgress(50);
      readFileWithEncoding(file).then(text => {
        fullTextRef.current = text;
        const previewLines = text.split("\n").slice(0, 100).join("\n");
        setFileInfo({
          name: file.name,
          previewLines,
          wordCount: countWords(text),
          charCount: text.length,
        });
        setHasText(true);
        setUploadProgress(null);
      }).catch(() => {
        toast.error("Không thể đọc file");
        setUploadProgress(null);
        setInputMode("paste");
      });
    },
    [],
  );

  const handleClearFile = useCallback(() => {
    fullTextRef.current = "";
    setFileInfo(null);
    setInputMode("paste");
    setHasText(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handlePasteChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setPasteText(value);
      fullTextRef.current = value;
      setHasText(!!value.trim());
    },
    [],
  );

  // ── Pattern Testing ─────────────────────────────────────

  const getActivePattern = useCallback((): RegExp | null => {
    if (useCustom) {
      return parseCustomRegex(customRegex);
    }
    const preset = CHAPTER_PRESETS[selectedPreset];
    return preset
      ? new RegExp(preset.pattern.source, preset.pattern.flags)
      : null;
  }, [useCustom, customRegex, selectedPreset]);

  const handleTest = useCallback(() => {
    const pattern = getActivePattern();
    if (!pattern) {
      toast.error("Biểu thức regex không hợp lệ");
      return;
    }
    const count = testPattern(fullTextRef.current, pattern);
    setMatchCount(count);
  }, [getActivePattern]);

  const handleSplit = useCallback(() => {
    if (splitMode === "length") {
      const result = splitByLength(fullTextRef.current, chunkSize);
      setChapters(result);
      setStep("preview");
      return;
    }

    const pattern = getActivePattern();
    if (!pattern) {
      toast.error("Biểu thức regex không hợp lệ");
      return;
    }
    const result = splitChapters(fullTextRef.current, pattern);
    setChapters(result);
    setStep("preview");
  }, [getActivePattern, splitMode, chunkSize]);

  // ── Chapter Editing ─────────────────────────────────────

  const startEditing = (index: number) => {
    setEditingIndex(index);
    setEditTitle(chapters[index].title);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    setChapters((prev) =>
      prev.map((ch, i) =>
        i === editingIndex ? { ...ch, title: editTitle } : ch,
      ),
    );
    setEditingIndex(null);
  };

  const deleteChapter = (index: number) => {
    setChapters((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Import ──────────────────────────────────────────────

  const handleImport = async () => {
    if (!novelTitle.trim()) {
      toast.error("Vui lòng nhập tiêu đề tiểu thuyết");
      return;
    }
    if (chapters.length === 0) {
      toast.error("Không có chương để nhập");
      return;
    }

    setIsImporting(true);
    try {
      const now = new Date();
      const novelId = crypto.randomUUID();

      // Pre-generate all IDs and objects outside of the transaction
      const chapterRecords: Array<{
        id: string;
        novelId: string;
        title: string;
        order: number;
        createdAt: Date;
        updatedAt: Date;
      }> = [];
      const sceneRecords: Array<{
        id: string;
        chapterId: string;
        novelId: string;
        title: string;
        content: string;
        order: number;
        wordCount: number;
        version: number;
        versionType: "manual";
        isActive: number;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const chapterId = crypto.randomUUID();
        chapterRecords.push({
          id: chapterId,
          novelId,
          title: ch.title,
          order: i,
          createdAt: now,
          updatedAt: now,
        });
        sceneRecords.push({
          id: crypto.randomUUID(),
          chapterId,
          novelId,
          title: ch.title,
          content: ch.content,
          order: 0,
          wordCount: ch.wordCount,
          version: 0,
          versionType: "manual",
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Insert in batches to avoid blocking mobile main thread
      const BATCH = 50;
      const toastId = toast.loading(`Đang nhập 0/${chapters.length} chương...`);

      await db.novels.add({
        id: novelId,
        title: novelTitle.trim(),
        description: novelDescription.trim(),
        createdAt: now,
        updatedAt: now,
      });

      for (let i = 0; i < chapterRecords.length; i += BATCH) {
        const chBatch = chapterRecords.slice(i, i + BATCH);
        const scBatch = sceneRecords.slice(i, i + BATCH);

        await db.transaction("rw", [db.chapters, db.scenes], async () => {
          await db.chapters.bulkAdd(chBatch);
          await db.scenes.bulkAdd(scBatch);
        });

        // Update progress and yield to main thread
        const done = Math.min(i + BATCH, chapterRecords.length);
        toast.loading(`Đang nhập ${done}/${chapters.length} chương...`, { id: toastId });

        // Yield to main thread to keep UI responsive
        await new Promise(r => setTimeout(r, 0));
      }

      toast.success(`Đã nhập "${novelTitle}" với ${chapters.length} chương`, { id: toastId });
      router.push("/dashboard");
    } catch (error) {
      toast.error(
        `Nhập thất bại: ${error instanceof Error ? error.message : "Lỗi không xác định"}`,
      );
    } finally {
      setIsImporting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────



  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-1 justify-center sm:gap-2">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 sm:gap-2">
            {i > 0 && (
              <div
                className={`h-px w-4 sm:w-8 ${i <= stepIndex ? "bg-primary" : "bg-border"}`}
              />
            )}
            <button
              onClick={() => {
                if (i < stepIndex) setStep(s.key);
              }}
              disabled={i > stepIndex}
              className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors sm:px-3 ${i === stepIndex
                ? "bg-primary text-primary-foreground"
                : i < stepIndex
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "bg-muted text-muted-foreground"
                }`}
            >
              <s.icon className="size-3.5 shrink-0" />
              <span className={i === stepIndex ? "sm:inline" : "hidden sm:inline"}>
                {s.label}
              </span>
            </button>
          </div>
        ))}
      </div>

      {/* Hidden file input (always mounted) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Step 1: Input */}
      {step === "input" && (
        <Card>
          <CardHeader>
            <CardTitle>Nhập văn bản tiểu thuyết</CardTitle>
            <CardDescription>
              Dán văn bản hoặc tải lên file .txt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {inputMode === "paste" ? (
              <>
                <div>
                  <Label htmlFor="novel-text">Văn bản tiểu thuyết</Label>
                  <Textarea
                    id="novel-text"
                    placeholder="Dán văn bản tiểu thuyết tại đây..."
                    className="mt-1.5 h-[300px] max-h-[300px] resize-none overflow-y-auto font-mono text-sm"
                    value={pasteText}
                    onChange={handlePasteChange}
                  />
                  {pasteText && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {countWords(pasteText).toLocaleString()} từ &middot;{" "}
                      {pasteText.length.toLocaleString()} ký tự
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">hoặc</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileTextIcon className="mr-1.5 size-3.5" />
                    Tải file .txt
                  </Button>
                </div>
              </>
            ) : uploadProgress !== null ? (
              <div className="space-y-3 py-8">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Đang đọc file...</span>
                  <span className="font-medium">{uploadProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : fileInfo ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileTextIcon className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{fileInfo.name}</span>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={handleClearFile}>
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{fileInfo.wordCount.toLocaleString()} từ</span>
                  <span>&middot;</span>
                  <span>{fileInfo.charCount.toLocaleString()} ký tự</span>
                </div>
                <ScrollArea className="h-[300px] rounded-md border">
                  <pre className="whitespace-pre-wrap p-3 font-mono text-xs text-muted-foreground">
                    {fileInfo.previewLines}
                  </pre>
                </ScrollArea>
                <p className="text-xs italic text-muted-foreground">
                  Chỉ hiển thị 100 dòng đầu tiên
                </p>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                onClick={() => setStep("configure")}
                disabled={!hasText}
              >
                Tiếp
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Configure */}
      {step === "configure" && (
        <Card>
          <CardHeader>
            <CardTitle>Cấu hình tách chương</CardTitle>
            <CardDescription>
              Chọn mẫu có sẵn hoặc nhập regex tùy chỉnh để phát hiện tiêu đề
              chương.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              <Label>Phương thức tách</Label>
              <div className="flex gap-4">
                <button
                  onClick={() => setSplitMode("regex")}
                  className={`flex-1 rounded-lg border p-3 text-left transition-colors ${splitMode === "regex" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                >
                  <p className="text-sm font-bold">Theo chương (Regex)</p>
                  <p className="text-xs text-muted-foreground mt-1">Dùng mẫu để tìm tên chương</p>
                </button>
                <button
                  onClick={() => setSplitMode("length")}
                  className={`flex-1 rounded-lg border p-3 text-left transition-colors ${splitMode === "length" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                >
                  <p className="text-sm font-bold">Theo ký tự</p>
                  <p className="text-xs text-muted-foreground mt-1">Chia nhỏ văn bản thành các phần bằng nhau</p>
                </button>
              </div>
            </div>

            <Separator />

            {splitMode === "regex" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Mẫu có sẵn</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(CHAPTER_PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => {
                          setSelectedPreset(key);
                          setUseCustom(false);
                          setMatchCount(null);
                        }}
                        className={`rounded-lg border p-3 text-left text-sm transition-colors ${!useCustom && selectedPreset === key
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                          }`}
                      >
                        <span className="font-medium">{preset.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {preset.pattern.source}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="use-custom"
                          checked={useCustom}
                          onChange={(e) => {
                            setUseCustom(e.target.checked);
                            setMatchCount(null);
                          }}
                          className="size-4 rounded border-border"
                        />
                        <Label htmlFor="use-custom">Sử dụng regex tùy chỉnh</Label>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Select
                          value={selectedProviderId}
                          onValueChange={(val) => setSelectedProviderId(val)}
                        >
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue placeholder="Chọn Provider AI" />
                          </SelectTrigger>
                          <SelectContent>
                            {providers?.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={selectedModelId}
                          onValueChange={setSelectedModelId}
                          disabled={!models || models.length === 0}
                        >
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue placeholder="Chọn Model AI" />
                          </SelectTrigger>
                          <SelectContent>
                            {models?.map((m: any) => (
                              <SelectItem key={m.modelId || m.id} value={m.modelId || m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-semibold text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 hover:text-amber-700 border-amber-500/20"
                          onClick={autoDetectRegex}
                          disabled={isDetectingRegex || !targetProvider || !selectedModelId}
                        >
                          {isDetectingRegex ? (
                            <><Loader2Icon className="size-3.5 mr-1.5 animate-spin" /> Đang phân tích...</>
                          ) : (
                            <><SparklesIcon className="size-3.5 mr-1.5" /> AI Phân tích định dạng</>
                          )}
                        </Button>
                      </div>
                    </div>
                    {useCustom && (
                      <Input
                        placeholder="e.g. /^Phần \d+/gm or ^VOLUME \d+"
                        value={customRegex}
                        onChange={(e) => {
                          setCustomRegex(e.target.value);
                          setMatchCount(null);
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={handleTest}>
                    Kiểm tra mẫu
                  </Button>
                  {matchCount !== null && (
                    <Badge variant="secondary">Tìm thấy {matchCount} kết quả</Badge>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="chunk-size">Số lượng ký tự mỗi chương</Label>
                  <div className="flex items-center gap-4">
                    <Input
                      id="chunk-size"
                      type="number"
                      value={chunkSize}
                      onChange={(e) => setChunkSize(parseInt(e.target.value) || 9000)}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">ký tự / chương</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gợi ý: 9,000 ký tự là kích thước tối ưu cho việc dịch STV.
                  </p>
                </div>

                <Badge variant="secondary" className="py-1">
                  Dự kiến: {Math.ceil(fullTextRef.current.length / chunkSize)} chương
                </Badge>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("input")}>
                Quay lại
              </Button>
              <Button onClick={handleSplit}>Tách & Xem trước</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && (
        <Card>
          <CardHeader>
            <CardTitle>Xem trước chương</CardTitle>
            <CardDescription>
              Phát hiện {chapters.length} chương &middot;{" "}
              {chapters
                .reduce((sum, ch) => sum + ch.wordCount, 0)
                .toLocaleString()}{" "}
              tổng số từ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[360px] pr-4">
              <div className="space-y-2">
                {chapters.map((ch, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <span className="mt-0.5 text-xs font-medium text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {editingIndex === i ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="h-7 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit();
                              if (e.key === "Escape") setEditingIndex(null);
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={saveEdit}
                          >
                            <CheckIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditingIndex(null)}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm font-medium">{ch.title}</p>
                      )}
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {ch.content.slice(0, 150)}
                        {ch.content.length > 150 ? "..." : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground/60">
                        {ch.wordCount.toLocaleString()} từ
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startEditing(i)}
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => deleteChapter(i)}
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="mt-4 flex justify-between">
              <Button variant="outline" onClick={() => setStep("configure")}>
                Quay lại
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={chapters.length === 0}
              >
                Tiếp
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirm */}
      {step === "confirm" && (
        <Card>
          <CardHeader>
            <CardTitle>Xác nhận nhập</CardTitle>
            <CardDescription>
              Thiết lập thông tin tiểu thuyết và nhập.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="novel-title">Tiêu đề tiểu thuyết</Label>
              <Input
                id="novel-title"
                placeholder="Nhập tiêu đề tiểu thuyết"
                value={novelTitle}
                onChange={(e) => setNovelTitle(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="novel-desc">Mô tả (tùy chọn)</Label>
              <Textarea
                id="novel-desc"
                placeholder="Mô tả ngắn..."
                value={novelDescription}
                onChange={(e) => setNovelDescription(e.target.value)}
                className="mt-1.5"
                rows={3}
              />
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-sm font-medium">Tóm tắt nhập</p>
              <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
                <span>{chapters.length} chương</span>
                <span>&middot;</span>
                <span>
                  {chapters
                    .reduce((sum, ch) => sum + ch.wordCount, 0)
                    .toLocaleString()}{" "}
                  từ
                </span>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("preview")}>
                Quay lại
              </Button>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? "Đang nhập..." : "Nhập tiểu thuyết"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Read a text file with smart encoding detection.
 * Tries UTF-8 first; if the result contains replacement characters (\uFFFD),
 * retries with GBK/Big5 encoding (common for Chinese .txt files).
 */
async function readFileWithEncoding(file: File): Promise<string> {
  const utf8Text = await file.text();

  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;
  const hasGarbled = replacementCount > 5;

  if (!hasGarbled) return utf8Text;

  // Try GBK/GB18030
  try {
    const buffer = await file.arrayBuffer();
    const gbkText = new TextDecoder('gbk').decode(buffer);
    const gbkReplacements = (gbkText.match(/\uFFFD/g) || []).length;
    if (/[\u4e00-\u9fff]/.test(gbkText) && gbkReplacements < replacementCount) {
      return gbkText;
    }
  } catch { }

  // Try Big5
  try {
    const buffer = await file.arrayBuffer();
    const big5Text = new TextDecoder('big5').decode(buffer);
    const big5Replacements = (big5Text.match(/\uFFFD/g) || []).length;
    if (/[\u4e00-\u9fff]/.test(big5Text) && big5Replacements < replacementCount) {
      return big5Text;
    }
  } catch { }

  return utf8Text;
}
