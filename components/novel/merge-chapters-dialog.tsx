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
import { Loader2Icon, CombineIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function MergeChaptersDialog({
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
  const [title, setTitle] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmWarning, setConfirmWarning] = useState(false);

  useEffect(() => {
    if (open && chapterIds.length > 0) {
      setConfirmWarning(false);
      // Find the first selected chapter (by order) to propose a base name
      const selected = chapters
        .filter((c) => chapterIds.includes(c.id))
        .sort((a, b) => a.order - b.order);

      if (selected.length > 0) {
        const firstTitle = selected[0].title;
        // Strip suffixes like " - Phần 1/3"
        const cleaned = firstTitle.replace(/\s*-\s*Phần\s*\d+\/\d+\s*/gi, "").trim();
        setTitle(cleaned);
      }
    }
  }, [open, chapterIds, chapters]);

  const handleMerge = useCallback(async () => {
    if (chapterIds.length < 2) {
      toast.error("Vui lòng chọn ít nhất 2 chương để gộp");
      return;
    }
    if (!title.trim()) {
      toast.error("Tiêu đề chương sau khi gộp không được để trống");
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Get and sort selected chapters
      const selectedChapters = chapters
        .filter((c) => chapterIds.includes(c.id))
        .sort((a, b) => a.order - b.order);

      const chapterIdsSet = new Set(chapterIds);
      // Fetch scenes ONLY for the selected chapter IDs to avoid loading all scenes of the novel
      const allActiveScenes = await db.scenes
        .where("chapterId")
        .anyOf(chapterIds)
        .filter((s) => s.isActive === 1)
        .toArray();

      // Sort scenes in the order of their parent chapters
      const sortedScenes = allActiveScenes.sort((a, b) => {
        const chA = selectedChapters.find((c) => c.id === a.chapterId);
        const chB = selectedChapters.find((c) => c.id === b.chapterId);
        return (chA?.order ?? 0) - (chB?.order ?? 0);
      });

      // 2. Join contents
      const mergedContent = sortedScenes.map((s) => s.content).join("\n\n");

      // 3. Database transaction
      await db.transaction("rw", [db.chapters, db.scenes], async () => {
        // Delete all selected chapters and their scenes
        await db.chapters.bulkDelete(chapterIds);
        await db.scenes.where("chapterId").anyOf(chapterIds).delete();

        // Add the single merged chapter
        const startOrder = selectedChapters[0].order;
        const newChapterId = crypto.randomUUID();
        const now = new Date();

        await db.chapters.add({
          id: newChapterId,
          novelId,
          title: title.trim(),
          order: startOrder,
          createdAt: now,
          updatedAt: now,
        });

        await db.scenes.add({
          id: crypto.randomUUID(),
          chapterId: newChapterId,
          novelId,
          title: title.trim(),
          content: mergedContent,
          order: 0,
          wordCount: countWords(mergedContent),
          version: 0,
          versionType: "manual",
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        });

        // Shift subsequent chapters' order by -(selectedChapters.length - 1)
        const shiftDiff = -(selectedChapters.length - 1);
        if (shiftDiff !== 0) {
          const subsequentChapters = chapters.filter(
            (c) => !chapterIdsSet.has(c.id) && c.order > startOrder
          );
          for (const ch of subsequentChapters) {
            await db.chapters.update(ch.id, { order: ch.order + shiftDiff });
          }
        }
      });

      toast.success(`Đã gộp thành công ${selectedChapters.length} phần thành chương "${title}"`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Lỗi khi gộp chương: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  }, [chapterIds, title, novelId, chapters, onOpenChange]);

  const selected = chapters
    .filter((c) => chapterIds.includes(c.id))
    .sort((a, b) => a.order - b.order);

  const orders = selected.map((c) => c.order);
  let isContiguous = true;
  for (let i = 1; i < orders.length; i++) {
    if (orders[i] !== orders[i - 1] + 1) {
      isContiguous = false;
      break;
    }
  }

  const isLargeMerge = chapterIds.length >= 5;
  const showWarning = !isContiguous || isLargeMerge;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <CombineIcon className="size-5" />
            Gộp nhiều chương/phần
          </DialogTitle>
          <DialogDescription>
            Gộp nội dung của <strong>{chapterIds.length}</strong> chương đã chọn thành 1 chương duy nhất theo đúng thứ tự đọc.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {showWarning && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              <span className="font-semibold text-amber-950 dark:text-amber-400">⚠️ Cảnh báo an toàn:</span>
              <ul className="mt-1 list-disc pl-4 space-y-1">
                {!isContiguous && (
                  <li>Bạn đang gộp các chương <strong>không liên tiếp</strong> nhau. Hãy kiểm tra kỹ xem có chọn nhầm hay không!</li>
                )}
                {isLargeMerge && (
                  <li>Bạn đang chọn gộp số lượng rất lớn (<strong>{chapterIds.length} chương</strong>). Việc này sẽ xóa sạch các chương gốc để thay bằng một chương mới gộp duy nhất.</li>
                )}
              </ul>
              
              <div className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  id="confirm-merge-warn"
                  checked={confirmWarning}
                  onChange={(e) => setConfirmWarning(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                />
                <label htmlFor="confirm-merge-warn" className="font-medium cursor-pointer select-none">
                  Tôi xác nhận muốn gộp và đồng ý xóa các chương cũ để thay bằng 1 chương gộp.
                </label>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="merge-title" className="text-sm font-medium">
              Tiêu đề chương sau khi gộp
            </Label>
            <Input
              id="merge-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề chương mới..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            Hủy
          </Button>
          <Button 
            onClick={handleMerge} 
            disabled={isProcessing || (showWarning && !confirmWarning)} 
            className="bg-primary text-primary-foreground hover:bg-primary/95"
          >
            {isProcessing ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Đang xử lý...
              </>
            ) : (
              "Gộp chương"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
