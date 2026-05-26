"use client";

import { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import {
  CHAPTER_PRESETS,
  parseCustomRegex,
  splitChapters,
  testPattern,
  type ChapterCandidate,
} from "@/lib/import";
import {
  CheckIcon,
  FileTextIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";

type Step = "input" | "configure" | "preview";

export function BulkAddChaptersDialog({
  open,
  onOpenChange,
  novelId,
  nextOrder,
  isAiWritten,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novelId: string;
  nextOrder: number;
  isAiWritten?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("input");
  const [rawText, setRawText] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("vietnamese");
  const [customRegex, setCustomRegex] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [chapters, setChapters] = useState<ChapterCandidate[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const wordCount = rawText ? countWords(rawText) : 0;

  const reset = () => {
    setStep("input");
    setRawText("");
    setSelectedPreset("vietnamese");
    setCustomRegex("");
    setUseCustom(false);
    setMatchCount(null);
    setChapters([]);
    setEditingIndex(null);
    setIsImporting(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // ── File Upload ─────────────────────────────────────────

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      // Smart encoding: try UTF-8, fallback to GBK for Chinese TXT files
      readFileWithEncoding(file).then(text => setRawText(text));
    },
    [],
  );

  // ── Pattern ─────────────────────────────────────────────

  const getActivePattern = useCallback((): RegExp | null => {
    if (useCustom) return parseCustomRegex(customRegex);
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
    setMatchCount(testPattern(rawText, pattern));
  }, [rawText, getActivePattern]);

  const handleSplit = useCallback(() => {
    const pattern = getActivePattern();
    if (!pattern) {
      toast.error("Biểu thức regex không hợp lệ");
      return;
    }
    setChapters(splitChapters(rawText, pattern));
    setStep("preview");
  }, [rawText, getActivePattern]);

  // ── Editing ─────────────────────────────────────────────

  const updateChapterTitle = (index: number, title: string) => {
    setChapters((prev) =>
      prev.map((ch, i) => (i === index ? { ...ch, title } : ch)),
    );
  };

  const removeChapter = (index: number) => {
    setChapters((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  // ── Import ──────────────────────────────────────────────

  const handleImport = async () => {
    if (chapters.length === 0) return;
    setIsImporting(true);
    try {
      const now = new Date();
      await db.transaction(
        "rw",
        [db.chapters, db.scenes],
        async () => {
          for (let i = 0; i < chapters.length; i++) {
             const ch = chapters[i];
             const chapterId = crypto.randomUUID();
             await db.chapters.add({
               id: chapterId,
               novelId,
               title: ch.title,
               order: nextOrder + i,
               isAiWritten,
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
              wordCount: ch.wordCount,
              version: 0,
              versionType: "manual",
              isActive: 1,
              createdAt: now,
              updatedAt: now,
            });
          }
        },
      );
      toast.success(`Đã thêm ${chapters.length} chương`);
      handleOpenChange(false);
    } catch {
      toast.error("Thêm chương thất bại");
    } finally {
      setIsImporting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === "input" && "Thêm nhiều chương"}
            {step === "configure" && "Cấu hình tách chương"}
            {step === "preview" && "Xem trước chương"}
          </DialogTitle>
          <DialogDescription>
            {step === "input" && "Dán văn bản hoặc tải file .txt chứa nhiều chương."}
            {step === "configure" &&
              "Chọn mẫu có sẵn hoặc nhập regex tùy chỉnh để phát hiện tiêu đề chương."}
            {step === "preview" &&
              `Phát hiện ${chapters.length} chương · ${chapters
                .reduce((s, c) => s + c.wordCount, 0)
                .toLocaleString()} từ`}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Input */}
        {step === "input" && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="bulk-text">Văn bản</Label>
              <Textarea
                id="bulk-text"
                placeholder="Dán văn bản chứa nhiều chương tại đây..."
                className="mt-1.5 h-[250px] max-h-[250px] resize-none overflow-y-auto font-mono text-sm"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
              {rawText && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {wordCount.toLocaleString()} từ · {rawText.length.toLocaleString()} ký tự
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Hủy
              </Button>
              <Button onClick={() => setStep("configure")} disabled={!rawText.trim()}>
                Tiếp
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Configure */}
        {step === "configure" && (
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
                    className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                      !useCustom && selectedPreset === key
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

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="bulk-use-custom"
                  checked={useCustom}
                  onChange={(e) => {
                    setUseCustom(e.target.checked);
                    setMatchCount(null);
                  }}
                  className="size-4 rounded border-border"
                />
                <Label htmlFor="bulk-use-custom">Sử dụng regex tùy chỉnh</Label>
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

            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={handleTest}>
                Kiểm tra mẫu
              </Button>
              {matchCount !== null && (
                <Badge variant="secondary">
                  Tìm thấy {matchCount} kết quả
                </Badge>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("input")}>
                Quay lại
              </Button>
              <Button onClick={handleSplit}>Tách & Xem trước</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === "preview" && (
          <div className="space-y-4">
            <ScrollArea className="h-[350px] pr-4">
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
                            value={ch.title}
                            onChange={(e) => updateChapterTitle(i, e.target.value)}
                            className="h-7 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape")
                                setEditingIndex(null);
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditingIndex(null)}
                          >
                            <CheckIcon className="size-3.5" />
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
                        onClick={() => setEditingIndex(i)}
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeChapter(i)}
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("configure")}>
                Quay lại
              </Button>
              <Button
                onClick={handleImport}
                disabled={chapters.length === 0 || isImporting}
              >
                {isImporting
                  ? "Đang thêm..."
                  : `Thêm ${chapters.length} chương`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  const latin = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (cjk?.length ?? 0) + latin.length;
}

/**
 * Read a text file with smart encoding detection.
 * Tries UTF-8 first; if the result contains replacement characters (\uFFFD),
 * retries with GBK encoding (common for Chinese .txt files).
 */
async function readFileWithEncoding(file: File): Promise<string> {
  // First try UTF-8
  const utf8Text = await file.text();
  
  // Check for replacement characters (indicates wrong encoding)
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;
  const hasGarbled = replacementCount > 5; // More than 5 replacement chars = likely wrong encoding
  
  if (!hasGarbled) return utf8Text;
  
  // Try GBK/GB18030 (common Chinese encoding)
  try {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const gbkText = decoder.decode(buffer);
    
    // Verify GBK decode is better (has Chinese chars, fewer replacements)
    const gbkReplacements = (gbkText.match(/\uFFFD/g) || []).length;
    const hasChinese = /[\u4e00-\u9fff]/.test(gbkText);
    
    if (hasChinese && gbkReplacements < replacementCount) {
      return gbkText;
    }
  } catch {
    // GBK decoding failed, fall back to UTF-8
  }
  
  // Try Big5 (Traditional Chinese)
  try {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('big5');
    const big5Text = decoder.decode(buffer);
    const big5Replacements = (big5Text.match(/\uFFFD/g) || []).length;
    const hasChinese = /[\u4e00-\u9fff]/.test(big5Text);
    
    if (hasChinese && big5Replacements < replacementCount) {
      return big5Text;
    }
  } catch {
    // Big5 failed too
  }
  
  return utf8Text; // Fallback to original UTF-8
}
