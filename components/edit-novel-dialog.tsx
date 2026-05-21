"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { updateNovel } from "@/lib/hooks";
import { type Novel } from "@/lib/db";
import { useDictMeta } from "@/lib/hooks/use-dict-entries";
import { cn } from "@/lib/utils";
import { ImagePicker } from "@/components/ui/image-picker";
import { PlusIcon, XIcon, CheckIcon } from "lucide-react";

const GENRE_DICTS = [
  "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong",
  "dothi", "vongdu", "dongnhan", "ngontinh"
];

const GENRE_LABELS: Record<string, string> = {
  hiendai: "Hiện đại", tienhiep: "Tiên hiệp", huyenhuyen: "Huyền huyễn",
  dammi: "Đam mỹ", hocduong: "Học đường", dothi: "Đô thị",
  vongdu: "Võng du", dongnhan: "Đồng nhân", ngontinh: "Ngôn tình"
};

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#78716c", // stone
];

export function EditNovelDialog({
  open,
  onOpenChange,
  novel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novel: Novel;
}) {
  const [title, setTitle] = useState(novel.title);
  const [description, setDescription] = useState(novel.description);
  const [author, setAuthor] = useState(novel.author ?? "");
  const [sourceUrl, setSourceUrl] = useState(novel.sourceUrl ?? "");
  const [color, setColor] = useState(novel.color ?? PRESET_COLORS[5]);
  const [genres, setGenres] = useState<string[]>(novel.genres ?? []);
  const [tags, setTags] = useState<string[]>(novel.tags ?? []);
  const [activeDictSources, setActiveDictSources] = useState<string[]>(novel.activeDictSources ?? []);
  const [coverImage, setCoverImage] = useState<string | undefined>(novel.coverImage);
  const [keepLocal, setKeepLocal] = useState(novel.keepLocal ?? false);
  const [saving, setSaving] = useState(false);

  const dictMeta = useDictMeta();
  const dynamicGenres = (() => {
    if (!dictMeta) return [];
    const genres = new Set<string>();
    for (const source of Object.keys(dictMeta.sources)) {
      const g = source.split("_")[0];
      if (g && g !== "core" && !GENRE_DICTS.includes(g)) {
        genres.add(g);
      }
    }
    return Array.from(genres);
  })();
  const allGenreSources = [...GENRE_DICTS, ...dynamicGenres];

  // Sync state when dialog opens
  useEffect(() => {
    if (open) {
      setTitle(novel.title);
      setDescription(novel.description);
      setAuthor(novel.author ?? "");
      setSourceUrl(novel.sourceUrl ?? "");
      setColor(novel.color ?? PRESET_COLORS[5]);
      setGenres(novel.genres ?? []);
      setTags(novel.tags ?? []);
      setActiveDictSources(novel.activeDictSources ?? []);
      setCoverImage(novel.coverImage);
      setKeepLocal(novel.keepLocal ?? false);
    }
  }, [open, novel]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    try {
      await updateNovel(novel.id, {
        title: title.trim(),
        description: description.trim(),
        color,
        author: author.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
        genres,
        tags,
        activeDictSources,
        coverImage: coverImage || undefined,
        keepLocal,
      });

      toast.success("Đã cập nhật tiểu thuyết");
      onOpenChange(false);
    } catch {
      toast.error("Cập nhật thất bại");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa tiểu thuyết</DialogTitle>
          <DialogDescription>
            Cập nhật thông tin tiểu thuyết.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="flex gap-4">
              <ImagePicker
                value={coverImage}
                onChange={setCoverImage}
                aspectRatio="aspect-[2/3]"
                maxSize={600}
                className="w-24 shrink-0"
                placeholder="Ảnh bìa"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <Label htmlFor="edit-novel-title">
                    Tiêu đề <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit-novel-title"
                    placeholder="Tên tiểu thuyết"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1.5"
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="edit-novel-author">Tác giả</Label>
                  <Input
                    id="edit-novel-author"
                    placeholder="Tên tác giả"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="edit-novel-description">Mô tả</Label>
              <Textarea
                id="edit-novel-description"
                placeholder="Mô tả ngắn gọn về câu chuyện..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1.5 min-h-[80px]"
              />
            </div>

            <div>
              <Label htmlFor="edit-novel-source">
                Đường dẫn truyện gốc{" "}
                <span className="text-muted-foreground font-normal">
                  (tùy chọn)
                </span>
              </Label>
              <Input
                id="edit-novel-source"
                type="url"
                placeholder="https://..."
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {/* Genres */}
            <div>
              <Label>Thể loại</Label>
              <BadgeListEditor
                values={genres}
                onChange={setGenres}
                variant="default"
              />
            </div>

            {/* Tags */}
            <div>
              <Label>Nhãn</Label>
              <BadgeListEditor
                values={tags}
                onChange={setTags}
                variant="secondary"
              />
            </div>

            {/* Dictionary Genres */}
            <div className="pt-2 border-t">
              <Label>Từ điển dịch truyện (Chọn bối cảnh/ngữ cảnh)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Các từ điển này sẽ được ưu tiên đè lên VietPhrase chung để xưng hô và thuật ngữ chuẩn theo thể loại.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allGenreSources.map((src) => {
                  const isActive = activeDictSources.includes(src);
                  return (
                    <button
                      key={src}
                      type="button"
                      onClick={() => {
                        if (isActive) {
                          setActiveDictSources(activeDictSources.filter(s => s !== src));
                        } else {
                          setActiveDictSources([...activeDictSources, src]);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors border",
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {isActive && <CheckIcon className="size-3" />}
                      {GENRE_LABELS[src] || src}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Màu sắc</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      "size-7 rounded-full border-2 transition-all hover:scale-110",
                      color === c
                        ? "border-foreground ring-2 ring-foreground/20"
                        : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
                <label
                  className={cn(
                    "relative flex size-7 cursor-pointer items-center justify-center rounded-full border-2 transition-all hover:scale-110",
                    !PRESET_COLORS.includes(color)
                      ? "border-foreground ring-2 ring-foreground/20"
                      : "border-muted-foreground/30"
                  )}
                  style={{
                    background: !PRESET_COLORS.includes(color)
                      ? color
                      : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                  }}
                  aria-label="Chọn màu tùy chỉnh"
                >
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t">
              <input
                type="checkbox"
                id="edit-novel-keeplocal"
                checked={keepLocal}
                onChange={(e) => setKeepLocal(e.target.checked)}
                className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
              />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="edit-novel-keeplocal" className="cursor-pointer font-medium">
                  Giữ lại thiết bị
                </Label>
                <p className="text-xs text-muted-foreground">
                  Không tự động tải lên Phòng Đọc & không tự động xóa khi chạy 同步 & dọn dẹp.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline badge list editor ───────────────────────────────

function BadgeListEditor({
  values,
  onChange,
  variant = "default",
}: {
  values: string[];
  onChange: (values: string[]) => void;
  variant?: "default" | "secondary" | "outline";
}) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const trimmed = newValue.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setNewValue("");
    setAdding(false);
  };

  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {values.map((v, i) => (
        <Badge key={`${v}-${i}`} variant={variant} className="gap-1 pr-1">
          {v}
          <button
            type="button"
            onClick={() => handleRemove(i)}
            className="ml-0.5 rounded-sm p-0.5 opacity-50 transition-opacity hover:opacity-100"
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      {adding ? (
        <Input
          ref={inputRef}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
            if (e.key === "Escape") {
              setNewValue("");
              setAdding(false);
            }
          }}
          onBlur={handleAdd}
          placeholder="Nhập và nhấn Enter"
          className="h-6 w-32 text-xs"
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-6 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <PlusIcon className="size-3" />
          Thêm
        </button>
      )}
    </div>
  );
}
