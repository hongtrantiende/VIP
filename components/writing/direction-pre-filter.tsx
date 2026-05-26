"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Character, PlotArc } from "@/lib/db";
import { useCharacters, usePlotArcs } from "@/lib/hooks";
import { useChapterPlan } from "@/lib/hooks/use-chapter-plans";
import { useWritingPipelineStore } from "@/lib/stores/writing-pipeline";
import { cn } from "@/lib/utils";
import { MapIcon, UsersIcon } from "lucide-react";
import { useEffect } from "react";

function parseChapterRange(text: string): { start: number; end: number } | null {
  if (!text) return null;
  const regexes = [
    /(?:Chương|Ch\.?|chương)\s*(\d+)\s*(?:[-–—]|đến|tới|to)\s*(\d+)/i,
    /\((\d+)\s*(?:[-–—]|đến|tới|to)\s*(\d+)\)/i,
    /(\d+)\s*(?:[-–—]|đến|tới|to)\s*(\d+)\s*(?:chương|ch\.?)/i
  ];

  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (!isNaN(start) && !isNaN(end)) {
        return { start, end };
      }
    }
  }
  return null;
}

export function DirectionPreFilter({
  novelId,
  chapterPlanId,
  hideCharacters = false,
}: {
  novelId: string;
  chapterPlanId?: string;
  hideCharacters?: boolean;
}) {
  const characters = useCharacters(novelId);
  const plotArcs = usePlotArcs(novelId);
  const activeArcs = plotArcs?.filter((a) => a.status === "active") ?? [];
  const plan = useChapterPlan(chapterPlanId);

  const selectedArcIds = useWritingPipelineStore((s) => s.directionArcIds);
  const selectedCharIds = useWritingPipelineStore(
    (s) => s.directionCharacterIds,
  );
  const setArcIds = useWritingPipelineStore((s) => s.setDirectionArcIds);
  const setCharIds = useWritingPipelineStore((s) => s.setDirectionCharacterIds);

  // Auto-select relevant MC Trajectory (arc) based on plan's chapterOrder
  useEffect(() => {
    if (!plan || !activeArcs.length) return;

    const chapterOrder = plan.chapterOrder;
    const matchedArc = activeArcs.find((arc) => {
      const range = parseChapterRange(arc.title) || parseChapterRange(arc.description);
      if (range) {
        return chapterOrder >= range.start && chapterOrder <= range.end;
      }
      return false;
    });

    if (matchedArc) {
      setArcIds([matchedArc.id]);
    }
  }, [plan?.id, plan?.chapterOrder, activeArcs.length]);

  const toggleArc = (id: string) => {
    setArcIds(
      selectedArcIds.includes(id)
        ? selectedArcIds.filter((x) => x !== id)
        : [...selectedArcIds, id],
    );
  };

  const toggleChar = (id: string) => {
    setCharIds(
      selectedCharIds.includes(id)
        ? selectedCharIds.filter((x) => x !== id)
        : [...selectedCharIds, id],
    );
  };

  const ARC_TYPE_COLOR: Record<string, string> = {
    main: "text-red-600 dark:text-red-400",
    subplot: "text-amber-600 dark:text-amber-400",
    character: "text-violet-600 dark:text-violet-400",
  };

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 overflow-hidden">
      <div>
        <h3 className="text-sm font-semibold">Lọc nội dung cho chương</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Chọn hướng đi nhân vật và nhân vật cần tập trung. Để trống = dùng tất cả.
        </p>
      </div>

      {/* Arcs */}
      {activeArcs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <MapIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium">
              Hướng đi nhân vật ({selectedArcIds.length || "tất cả"})
            </Label>
          </div>
          <div className="max-h-[240px] overflow-y-auto overflow-x-hidden space-y-1">
            {activeArcs.map((arc) => (
              <ArcItem
                key={arc.id}
                arc={arc}
                checked={selectedArcIds.includes(arc.id)}
                onToggle={() => toggleArc(arc.id)}
                typeColor={ARC_TYPE_COLOR[arc.type] ?? ""}
              />
            ))}
          </div>
        </div>
      )}

      {/* Characters */}
      {!hideCharacters && characters && characters.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium">
              Nhân vật ({selectedCharIds.length || "tất cả"})
            </Label>
          </div>
          <div className="max-h-[240px] overflow-y-auto overflow-x-hidden">
            <div className="flex flex-wrap gap-1.5">
              {characters.map((c) => (
                <CharacterChip
                  key={c.id}
                  character={c}
                  checked={selectedCharIds.includes(c.id)}
                  onToggle={() => toggleChar(c.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArcItem({
  arc,
  checked,
  onToggle,
  typeColor,
}: {
  arc: PlotArc;
  checked: boolean;
  onToggle: () => void;
  typeColor: string;
}) {
  return (
    <label
      className={cn(
        "flex w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
        checked ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate">{arc.title}</span>
          <Badge
            variant="secondary"
            className="text-[10px] font-semibold shrink-0 bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
          >
            Lộ trình
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">
          {arc.description}
        </p>
      </div>
    </label>
  );
}

function CharacterChip({
  character,
  checked,
  onToggle,
}: {
  character: Character;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors max-w-full",
        checked
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          checked ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      <span className="truncate">{character.name}</span>
      <span className="text-[10px] opacity-60 truncate">
        ({character.role})
      </span>
    </button>
  );
}
