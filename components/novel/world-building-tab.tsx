"use client";

import { Button } from "@/components/ui/button";
import type { NameDescription, Novel } from "@/lib/db";
import { updateNovel } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
  BookOpenIcon,
  CalendarIcon,
  CpuIcon,
  GlobeIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  ScrollTextIcon,
  ShieldIcon,
  SwordsIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { EditableText } from "./editable-text";
import { FactionEditDialog } from "./faction-edit-dialog";

// ─── Color theme per section ────────────────────────────────

const SECTION_THEMES = {
  worldOverview: { icon: GlobeIcon, color: "text-blue-600 dark:text-blue-400" },
  storySetting: { icon: MapPinIcon, color: "text-emerald-600 dark:text-emerald-400" },
  timePeriod: { icon: CalendarIcon, color: "text-amber-600 dark:text-amber-400" },
  powerSystem: { icon: SwordsIcon, color: "text-red-600 dark:text-red-400" },
  factions: { icon: ShieldIcon, color: "text-violet-600 dark:text-violet-400" },
  locations: { icon: MapPinIcon, color: "text-cyan-600 dark:text-cyan-400" },
  worldRules: { icon: ScrollTextIcon, color: "text-orange-600 dark:text-orange-400" },
  technologyLevel: { icon: CpuIcon, color: "text-pink-600 dark:text-pink-400" },
  perspective: { icon: BookOpenIcon, color: "text-indigo-600 dark:text-indigo-400" },
  pronouns: { icon: ScrollTextIcon, color: "text-teal-600 dark:text-teal-400" },
  writingStyle: { icon: PencilIcon, color: "text-rose-600 dark:text-rose-400" },
} as const;

// ─── ItemList (factions / locations) ────────────────────────

function ItemList({
  items,
  type,
  onUpdate,
}: {
  items: NameDescription[];
  type: "faction" | "location";
  onUpdate: (items: NameDescription[]) => void;
}) {
  const [editItem, setEditItem] = useState<NameDescription | undefined>();
  const [editIndex, setEditIndex] = useState(-1);
  const [addOpen, setAddOpen] = useState(false);

  const theme =
    type === "faction" ? SECTION_THEMES.factions : SECTION_THEMES.locations;
  const label = type === "faction" ? "Phe phái" : "Địa điểm";
  const Icon = theme.icon;

  return (
    <>
      <div className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-lg",
                "bg-muted",
                theme.color,
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              {label}
            </p>
            {items.length > 0 && (
              <span className="text-[10px] text-muted-foreground/60">
                ({items.length})
              </span>
            )}
          </div>
          <Button variant="outline" size="xs" onClick={() => setAddOpen(true)}>
            <PlusIcon className="size-3" />
            Thêm
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="py-2 text-center text-xs italic text-muted-foreground/60">
            Chưa có {label.toLowerCase()} nào
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item, i) => (
              <div
                key={`${item.name}-${i}`}
                className="group flex items-start gap-3 rounded-lg border border-border/50 bg-background/60 p-3 transition-colors hover:bg-background"
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
                    "bg-muted",
                    theme.color,
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.name}</p>
                  {item.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      setEditItem(item);
                      setEditIndex(i);
                    }}
                  >
                    <PencilIcon className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onUpdate(items.filter((_, j) => j !== i))}
                  >
                    <TrashIcon className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <FactionEditDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        type={type}
        onSave={(item) => onUpdate([...items, item])}
      />

      {editItem && (
        <FactionEditDialog
          open={editIndex >= 0}
          onOpenChange={(open) => {
            if (!open) {
              setEditItem(undefined);
              setEditIndex(-1);
            }
          }}
          type={type}
          item={editItem}
          onSave={(updated) => {
            onUpdate(items.map((it, i) => (i === editIndex ? updated : it)));
            setEditItem(undefined);
            setEditIndex(-1);
          }}
        />
      )}
    </>
  );
}

// ─── Main tab ───────────────────────────────────────────────

export function WorldBuildingTab({
  novel,
}: {
  novel: Novel;
}) {
  const save = (field: string, value: unknown) => {
    updateNovel(novel.id, { [field]: value });
  };

  const section = (
    themeKey: keyof typeof SECTION_THEMES,
    label: string,
    field: keyof Novel,
    multi = true,
  ) => {
    const theme = SECTION_THEMES[themeKey];
    const Icon = theme.icon;
    return (
      <div className="rounded-xl border p-4">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-lg bg-muted",
              theme.color,
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {label}
          </p>
        </div>
        <EditableText
          value={
            (typeof novel[field] === "string" ? novel[field] : "") ?? ""
          }
          onSave={(v) => save(field, v || undefined)}
          placeholder={`Chưa có ${label.toLowerCase()}...`}
          multiline={multi}
          displayClassName="text-sm leading-relaxed"
        />
      </div>
    );
  };

  const isRewrite = !!novel.referenceNovelId;

  // Count filled sections for overview
  const filledCount = [
    novel.worldOverview,
    novel.storySetting,
    novel.timePeriod,
    novel.powerSystem,
    novel.factions?.length,
    novel.keyLocations?.length,
    !isRewrite ? novel.worldRules : null,
    !isRewrite ? novel.technologyLevel : null,
    novel.perspective,
    novel.pronouns,
    novel.writingStyle,
  ].filter(Boolean).length;

  const maxCount = isRewrite ? 9 : 11;

  return (
    <div>
      {/* Overview badge */}
      <div className="mb-4 flex items-center gap-2">
        <BookOpenIcon className="size-4 text-muted-foreground/50" />
        <span className="text-xs text-muted-foreground">
          {filledCount}/{maxCount} mục đã điền
        </span>
        <div className="flex gap-0.5">
          {Array.from({ length: maxCount }, (_, i) => (
            <div
              key={i}
              className={cn(
                "size-1.5 rounded-full",
                i < filledCount
                  ? "bg-primary/60"
                  : "bg-muted-foreground/20",
              )}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Full-width sections */}
        <div className="sm:col-span-2">
          {section("worldOverview", "Tổng quan thế giới", "worldOverview")}
        </div>

        {section("storySetting", "Bối cảnh câu chuyện", "storySetting")}
        {section("timePeriod", "Thời kỳ", "timePeriod", false)}

        {section("perspective", "Góc nhìn kể chuyện", "perspective")}
        {section("pronouns", "Đại từ và Xưng hô", "pronouns")}

        <div className="sm:col-span-2">
          {section("writingStyle", "Phong cách hành văn", "writingStyle")}
        </div>

        <div className="sm:col-span-2">
          {section("powerSystem", "Hệ thống sức mạnh", "powerSystem")}
        </div>

        {/* Lists — full width */}
        <div className="sm:col-span-2">
          <ItemList
            items={novel.factions ?? []}
            type="faction"
            onUpdate={(v) => save("factions", v)}
          />
        </div>
        <div className="sm:col-span-2">
          <ItemList
            items={novel.keyLocations ?? []}
            type="location"
            onUpdate={(v) => save("keyLocations", v)}
          />
        </div>

        {!isRewrite && section("worldRules", "Quy luật thế giới", "worldRules")}
        {!isRewrite && section("technologyLevel", "Trình độ công nghệ", "technologyLevel", false)}
      </div>
    </div>
  );
}
