"use client";

import { ConvertSegment, ConvertSource } from "@/lib/workers/qt-engine.types";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { NameFixDialog } from "./name-fix-dialog";

interface SegmentRendererProps {
  segments: ConvertSegment[];
  novelId?: string;
  onRefresh?: () => void;
  className?: string;
}

const SOURCE_COLORS: Record<ConvertSource, string> = {
  "novel-name": "text-orange-600 dark:text-orange-400 font-medium",
  "global-name": "text-blue-600 dark:text-blue-400 font-medium",
  "qt-name": "text-purple-600 dark:text-purple-400 font-medium",
  "auto-name": "text-emerald-600 dark:text-emerald-400 italic",
  "vietphrase": "",
  "genre-vietphrase": "text-teal-600 dark:text-teal-400",
  "core-vietphrase": "text-cyan-600 dark:text-cyan-400",
  "phienam": "text-muted-foreground",
  "luatnhan": "text-indigo-600 dark:text-indigo-400",
  "unknown": "text-red-500",
};

export function SegmentRenderer({
  segments,
  novelId,
  onRefresh,
  className,
}: SegmentRendererProps) {
  const [fixingSegment, setFixingSegment] = useState<ConvertSegment | null>(null);

  if (!segments.length) return null;

  return (
    <div className={cn("leading-relaxed", className)}>
      {segments.map((seg, i) => {
        const isInteractive = seg.source !== "unknown" && seg.source !== "phienam";
        
        return (
          <span
            key={i}
            className={cn(
              "cursor-default transition-colors duration-200 hover:bg-primary/10",
              SOURCE_COLORS[seg.source],
              isInteractive && "cursor-pointer"
            )}
            title={isInteractive ? `Click để sửa "${seg.original}"` : undefined}
            onClick={() => {
              if (isInteractive) setFixingSegment(seg);
            }}
          >
            {seg.translated}
            {/* Logic for spacing is usually handled in segmentsToPlainText, 
                but here we just render them. We might need spaces between segments 
                if the segments don't already contain them. */}
            {" "}
          </span>
        );
      })}

      {fixingSegment && (
        <NameFixDialog
          open={!!fixingSegment}
          onOpenChange={(open) => !open && setFixingSegment(null)}
          chinese={fixingSegment.original}
          initialVietnamese={fixingSegment.translated}
          novelId={novelId}
          onSuccess={onRefresh}
        />
      )}
    </div>
  );
}
