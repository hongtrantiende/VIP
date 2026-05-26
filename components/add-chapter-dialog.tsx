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
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { createChapter } from "@/lib/hooks";
import { useState } from "react";
import { toast } from "sonner";

export function AddChapterDialog({
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
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    try {
      const chapterId = await createChapter({
        novelId,
        title: title.trim(),
        order: nextOrder,
        isAiWritten,
      });

      // Create a single scene with the chapter content
      if (content.trim()) {
        const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
        const now = new Date();
        await db.scenes.add({
          id: crypto.randomUUID(),
          chapterId,
          novelId,
          title: title.trim(),
          content: content.trim(),
          order: 0,
          wordCount,
          version: 0,
          versionType: "manual",
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        });
      }

      toast.success(`Đã thêm chương "${title.trim()}"`);
      setTitle("");
      setContent("");
      onOpenChange(false);
    } catch {
      toast.error("Thêm chương thất bại");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm chương</DialogTitle>
          <DialogDescription>
            Thêm chương mới vào tiểu thuyết.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="chapter-title">Tiêu đề</Label>
              <Input
                id="chapter-title"
                placeholder="Tiêu đề chương"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1.5"
                required
              />
            </div>
            <div>
              <Label htmlFor="chapter-content">Nội dung (tùy chọn)</Label>
              <Textarea
                id="chapter-content"
                placeholder="Nội dung chương..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="mt-1.5 min-h-[200px] max-h-[50vh] overscroll-auto font-mono text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Đang thêm..." : "Thêm chương"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
