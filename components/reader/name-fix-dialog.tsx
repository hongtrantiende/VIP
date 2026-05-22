"use client";

import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NAME_ENTRY_CATEGORIES } from "@/lib/db";
import { createNameEntry, updateNameEntry } from "@/lib/hooks/use-name-entries";
import { db } from "@/lib/db";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface NameFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chinese: string;
  initialVietnamese: string;
  novelId?: string;
  onSuccess?: () => void;
}

export function NameFixDialog({
  open,
  onOpenChange,
  chinese,
  initialVietnamese,
  novelId,
  onSuccess,
}: NameFixDialogProps) {
  const [vietnamese, setVietnamese] = useState(initialVietnamese);
  const [category, setCategory] = useState("nhân vật");
  const [scope, setScope] = useState<"global" | "novel">(novelId ? "novel" : "global");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setVietnamese(initialVietnamese);
      // Check if entry already exists to pre-fill category
      const targetScope = scope === "novel" ? novelId! : "global";
      db.nameEntries
        .where("[scope+chinese]")
        .equals([targetScope, chinese])
        .first()
        .then((existing) => {
          if (existing) {
            setCategory(existing.category);
          }
        });
    }
  }, [open, initialVietnamese, chinese, scope, novelId]);

  const handleSave = async () => {
    if (!vietnamese.trim()) return;
    setIsSaving(true);
    try {
      const targetScope = scope === "novel" ? novelId! : "global";
      
      // Check if exists using compound index
      const existing = await db.nameEntries
        .where("[scope+chinese]")
        .equals([targetScope, chinese])
        .first();

      if (existing) {
        await updateNameEntry(existing.id, {
          vietnamese: vietnamese.trim(),
          category,
        });
        toast.success(`Đã cập nhật từ điển: ${chinese} -> ${vietnamese}`);
      } else {
        await createNameEntry({
          scope: targetScope,
          chinese,
          vietnamese: vietnamese.trim(),
          category,
        });
        toast.success(`Đã thêm vào từ điển: ${chinese} -> ${vietnamese}`);
      }
      
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("Lỗi khi lưu từ điển");
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sửa nhanh từ điển</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Trung văn</Label>
            <div className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
              {chinese}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fix-vietnamese">Bản dịch tiếng Việt</Label>
            <Input
              id="fix-vietnamese"
              value={vietnamese}
              onChange={(e) => setVietnamese(e.target.value)}
              placeholder="Nhập bản dịch..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phạm vi</Label>
              <Select
                value={scope}
                onValueChange={(v: any) => setScope(v)}
                disabled={!novelId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Chung (Tất cả truyện)</SelectItem>
                  {novelId && (
                    <SelectItem value="novel">Riêng (Truyện này)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Loại</Label>
              <Select value={category} onValueChange={setCategory}>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !vietnamese.trim()}>
            {isSaving ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
