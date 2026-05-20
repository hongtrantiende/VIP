"use client";

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
import { db, type Chapter } from "@/lib/db";
import { countWords } from "@/lib/utils";
import { Loader2Icon, ScissorsIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function SplitChapterDialog({
  open,
  onOpenChange,
  novelId,
  chapterIds,
  chapters,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novelId: string;
  chapterIds: string[];
  chapters: Chapter[];
}) {
  const [limit, setLimit] = useState<number>(2500);
  const [isProcessing, setIsProcessing] = useState(false);
  const [chapter, setChapter] = useState<Chapter | null>(null);

  useEffect(() => {
    if (open && chapterIds.length === 1) {
      const ch = chapters.find((c) => c.id === chapterIds[0]);
      setChapter(ch || null);
    } else {
      setChapter(null);
    }
  }, [open, chapterIds, chapters]);

  const handleSplit = useCallback(async () => {
    if (chapterIds.length === 0) return;
    if (limit < 100) {
      toast.error("Giới hạn mỗi phần tối thiểu phải là 100 ký tự");
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Fetch active scenes for all selected chapters
      const allActiveScenes = await db.scenes
        .where("chapterId")
        .anyOf(chapterIds)
        .filter((s) => s.isActive === 1)
        .toArray();

      if (chapterIds.length === 1 && allActiveScenes.length === 0) {
        throw new Error("Chương này không có nội dung để tách");
      }

      // 2. Sort all chapters of the novel by order to process sequentially
      const sortedChapters = [...chapters].sort((a, b) => a.order - b.order);
      const selectedIdsSet = new Set(chapterIds);

      // 3. Database transaction to perform splits and shifts sequentially
      const result = await db.transaction("rw", [db.chapters, db.scenes], async () => {
        let currentShift = 0;
        let totalSplitChapters = 0;
        let totalNewChaptersCreated = 0;
        const now = new Date();

        for (const ch of sortedChapters) {
          const isSelected = selectedIdsSet.has(ch.id);

          if (isSelected) {
            const activeScene = allActiveScenes.find((s) => s.chapterId === ch.id);
            const content = activeScene?.content || "";

            // Split logic at newline boundaries
            const paragraphs = content.split("\n");
            const parts: string[] = [];
            let currentPart: string[] = [];
            let currentLen = 0;

            for (const p of paragraphs) {
              if (currentLen + p.length > limit && currentPart.length > 0) {
                parts.push(currentPart.join("\n"));
                currentPart = [p];
                currentLen = p.length;
              } else {
                currentPart.push(p);
                currentLen += p.length + 1; // +1 for newline character
              }
            }

            if (currentPart.length > 0) {
              parts.push(currentPart.join("\n"));
            }

            if (parts.length > 1) {
              // Delete old chapter & scenes
              await db.chapters.delete(ch.id);
              await db.scenes.where("chapterId").equals(ch.id).delete();

              const baseTitle = ch.title.replace(/\s*-\s*Phần\s*\d+\/\d+\s*/gi, "").trim();
              const startOrder = ch.order;

              for (let i = 0; i < parts.length; i++) {
                const partContent = parts[i];
                const partTitle = `${baseTitle} - Phần ${i + 1}/${parts.length}`;
                const newChapterId = crypto.randomUUID();

                await db.chapters.add({
                  id: newChapterId,
                  novelId,
                  title: partTitle,
                  order: startOrder + currentShift + i,
                  createdAt: now,
                  updatedAt: now,
                });

                await db.scenes.add({
                  id: crypto.randomUUID(),
                  chapterId: newChapterId,
                  novelId,
                  title: partTitle,
                  content: partContent,
                  order: 0,
                  wordCount: countWords(partContent),
                  version: 0,
                  versionType: "manual",
                  isActive: 1,
                  createdAt: now,
                  updatedAt: now,
                });
              }

              totalSplitChapters++;
              totalNewChaptersCreated += parts.length;
              currentShift += parts.length - 1;
            } else {
              // Not split because it is under the character limit, just shift order if needed
              if (currentShift > 0) {
                await db.chapters.update(ch.id, { order: ch.order + currentShift });
              }
            }
          } else {
            // Unselected chapter: shift order if needed
            if (currentShift > 0) {
              await db.chapters.update(ch.id, { order: ch.order + currentShift });
            }
          }
        }

        return { totalSplitChapters, totalNewChaptersCreated };
      });

      if (result.totalSplitChapters === 0) {
        toast.info("Không có chương nào trong số đã chọn vượt quá giới hạn ký tự để tách.");
      } else {
        toast.success(
          chapterIds.length === 1
            ? `Đã tách chương thành ${result.totalNewChaptersCreated} phần thành công!`
            : `Đã tự động tách ${result.totalSplitChapters} chương thành ${result.totalNewChaptersCreated} phần!`
        );
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Lỗi khi tách chương: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  }, [chapterIds, limit, novelId, chapters, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <ScissorsIcon className="size-5" />
            {chapterIds.length === 1 ? "Tách chương thành các phần nhỏ" : "Tách chương hàng loạt"}
          </DialogTitle>
          <DialogDescription>
            {chapterIds.length === 1 ? (
              <>
                Tách chương <strong>&ldquo;{chapter?.title}&rdquo;</strong> thành các phần nhỏ hơn để dễ dịch và biên tập.
              </>
            ) : (
              <>
                Tách tự động các chương trong số <strong>{chapterIds.length} chương</strong> đã chọn vượt quá giới hạn ký tự. Các chương ngắn hơn giới hạn sẽ giữ nguyên.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="split-limit" className="text-sm font-medium">
              Giới hạn số ký tự mỗi phần
            </Label>
            <Input
              id="split-limit"
              type="number"
              min={100}
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value) || 2500)}
              placeholder="Mặc định: 2500 ký tự"
            />
            <p className="text-xs text-muted-foreground">
              Chương sẽ được tách tại các ranh giới xuống dòng gần nhất với giới hạn này để không làm vỡ các đoạn văn.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            Hủy
          </Button>
          <Button
            onClick={handleSplit}
            disabled={isProcessing}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isProcessing ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Đang xử lý...
              </>
            ) : (
              "Tách ngay"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
