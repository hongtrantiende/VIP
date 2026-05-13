"use client";

import { type ProgressInfo } from "@/lib/db-io";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle2Icon, XCircleIcon } from "lucide-react";

interface ProgressDialogProps {
  open: boolean;
  title: string;
  progress: ProgressInfo | null;
  onCancel: () => void;
  result?: { success: boolean; message: string } | null;
  onClose?: () => void;
}

export function ProgressDialog({
  open,
  title,
  progress,
  onCancel,
  result,
  onClose,
}: ProgressDialogProps) {
  const isInProgress = !result && progress;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isInProgress && onClose?.()}>
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(e) => {
          if (isInProgress) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isInProgress) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{result ? (result.success ? "Hoàn tất" : "Lỗi") : title}</DialogTitle>
          <DialogDescription className="sr-only">
            {result ? result.message : "Đang xử lý..."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col items-center gap-3 py-4">
            {result.success ? (
              <CheckCircle2Icon className="size-10 text-emerald-500" />
            ) : (
              <XCircleIcon className="size-10 text-destructive" />
            )}
            <p className="text-center text-sm">{result.message}</p>
          </div>
        ) : progress ? (
          <div className="space-y-3 py-2">
            <Progress value={progress.percentage} className="h-2" />
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Đang xử lý: {progress.tableName}...</span>
              <span>{progress.percentage}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {progress.current}/{progress.total} bảng
            </p>
          </div>
        ) : null}

        <DialogFooter>
          {isInProgress ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Ẩn
              </Button>
              <Button variant="outline" onClick={onCancel}>
                Huỷ
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Đóng</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
