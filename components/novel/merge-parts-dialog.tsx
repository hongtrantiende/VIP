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
import { db, type Chapter } from "@/lib/db";
import { countWords } from "@/lib/utils";
import { Loader2Icon, CombineIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function MergePartsDialog({
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [groupsToMerge, setGroupsToMerge] = useState<[string, Chapter[]][]>([]);

  useEffect(() => {
    if (open && chapterIds.length > 0) {
      // Find all selected chapters that match the split parts pattern
      const groups: { [baseTitle: string]: Chapter[] } = {};
      for (const chId of chapterIds) {
        const ch = chapters.find((c) => c.id === chId);
        if (ch) {
          const match = ch.title.match(/^(.*?)\s*-\s*Phần\s*\d+\/\d+\s*$/i);
          if (match) {
            const baseTitle = match[1].trim();
            if (!groups[baseTitle]) {
              groups[baseTitle] = [];
            }
            groups[baseTitle].push(ch);
          }
        }
      }

      // Filter groups that have at least 2 chapters
      const filtered = Object.entries(groups)
        .filter(([_, chList]) => chList.length >= 2)
        .sort((a, b) => {
          // Sort groups by the minimum order of chapters in each group
          const minA = Math.min(...a[1].map((c) => c.order));
          const minB = Math.min(...b[1].map((c) => c.order));
          return minA - minB;
        });

      setGroupsToMerge(filtered);
    } else {
      setGroupsToMerge([]);
    }
  }, [open, chapterIds, chapters]);

  const handleMerge = useCallback(async () => {
    if (groupsToMerge.length === 0) return;

    setIsProcessing(true);
    try {
      // Collect all chapter IDs that are part of any merge group
      const allMergeChapterIds = groupsToMerge.flatMap(([_, chList]) => chList.map((ch) => ch.id));
      const chapterToGroupMap = new Map<string, { baseTitle: string; allChapters: Chapter[] }>();

      for (const [baseTitle, chList] of groupsToMerge) {
        const sortedChList = [...chList].sort((a, b) => a.order - b.order);
        for (const ch of sortedChList) {
          chapterToGroupMap.set(ch.id, { baseTitle, allChapters: sortedChList });
        }
      }

      // Fetch scenes for these chapters
      const allActiveScenes = await db.scenes
        .where("chapterId")
        .anyOf(allMergeChapterIds)
        .filter((s) => s.isActive === 1)
        .toArray();

      // Sort all chapters of the novel by order
      const sortedChapters = [...chapters].sort((a, b) => a.order - b.order);

      await db.transaction("rw", [db.chapters, db.scenes], async () => {
        let currentShift = 0;
        const createdGroups = new Set<string>();

        for (const ch of sortedChapters) {
          const groupInfo = chapterToGroupMap.get(ch.id);

          if (groupInfo) {
            const { baseTitle, allChapters } = groupInfo;
            if (!createdGroups.has(baseTitle)) {
              createdGroups.add(baseTitle);

              // Get all chapter IDs in this group
              const groupChapterIds = allChapters.map((c) => c.id);

              // Gather and sort scenes based on chapter order
              const groupScenes = allActiveScenes
                .filter((s) => groupChapterIds.includes(s.chapterId))
                .sort((a, b) => {
                  const chA = allChapters.find((c) => c.id === a.chapterId);
                  const chB = allChapters.find((c) => c.id === b.chapterId);
                  return (chA?.order ?? 0) - (chB?.order ?? 0);
                });

              const mergedContent = groupScenes.map((s) => s.content).join("\n\n");

              // Delete old chapters/scenes of this group
              await db.chapters.bulkDelete(groupChapterIds);
              await db.scenes.where("chapterId").anyOf(groupChapterIds).delete();

              // Add the merged chapter
              const newChapterId = crypto.randomUUID();
              const now = new Date();
              const startOrder = ch.order;

              await db.chapters.add({
                id: newChapterId,
                novelId,
                title: baseTitle,
                order: startOrder + currentShift,
                createdAt: now,
                updatedAt: now,
              });

              await db.scenes.add({
                id: crypto.randomUUID(),
                chapterId: newChapterId,
                novelId,
                title: baseTitle,
                content: mergedContent,
                order: 0,
                wordCount: countWords(mergedContent),
                version: 0,
                versionType: "manual",
                isActive: 1,
                createdAt: now,
                updatedAt: now,
              });
            } else {
              // Subsequent chapters of this group: they are already deleted, just increment currentShift (decrease index)
              currentShift -= 1;
            }
          } else {
            // Unselected / non-grouped chapter: update order if currentShift is non-zero
            if (currentShift !== 0) {
              await db.chapters.update(ch.id, { order: ch.order + currentShift });
            }
          }
        }
      });

      toast.success(`Đã gộp thành công ${groupsToMerge.length} nhóm chương về nguyên bản!`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Lỗi khi gộp chương: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  }, [groupsToMerge, novelId, chapters, onOpenChange]);

  const totalParts = groupsToMerge.reduce((acc, [_, chList]) => acc + chList.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <CombineIcon className="size-5" />
            Gộp các phần đã tách
          </DialogTitle>
          <DialogDescription>
            Tự động phát hiện các chương dạng &ldquo;Chương X - Phần A/B&rdquo; và gộp lại thành chương gốc.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {groupsToMerge.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              Không tìm thấy phần chương nào đủ điều kiện để gộp lại trong số các chương bạn đã chọn. 
              <br />
              <span className="mt-1 block font-medium">Lưu ý: Các chương cần gộp phải có định dạng tiêu đề chứa hậu tố &ldquo; - Phần X/Y&rdquo; (ví dụ: &ldquo;Chương 1 - Phần 1/3&rdquo;).</span>
            </div>
          ) : (
            <div className="space-y-2">
              <span className="text-sm font-medium">
                Tìm thấy <strong>{groupsToMerge.length}</strong> nhóm chương ({totalParts} phần) có thể gộp lại:
              </span>
              <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-2 text-xs space-y-1">
                {groupsToMerge.map(([baseTitle, chList]) => (
                  <div key={baseTitle} className="flex justify-between py-0.5 border-b border-muted last:border-0">
                    <span className="font-medium text-foreground">{baseTitle}</span>
                    <span className="text-muted-foreground">{chList.length} phần</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            Hủy
          </Button>
          <Button
            onClick={handleMerge}
            disabled={isProcessing || groupsToMerge.length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/95"
          >
            {isProcessing ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Đang xử lý...
              </>
            ) : (
              "Gộp ngay"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
