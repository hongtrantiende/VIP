import { db } from "@/lib/db";

/** @deprecated Depth is now unified — kept for backward API compatibility */
export type ContextDepth = "quick" | "standard" | "deep";

// Unified config: 1 chapter summary + 8 trailing lines + full metadata + filtered dictionary
const UNIFIED_CONFIG = { maxChapters: 1, includeDetails: true, trailingLines: 8 };
const DEPTH_CONFIG: Record<ContextDepth, typeof UNIFIED_CONFIG> = {
  quick: UNIFIED_CONFIG,
  standard: UNIFIED_CONFIG,
  deep: UNIFIED_CONFIG,
};

// ── Dynamic Dictionary Filtering ────────────────────────────

/**
 * Filter a name dictionary to only include entries whose Chinese term
 * actually appears in the source text. This dramatically reduces token
 * usage (e.g. 1000 entries → 10 relevant entries) while keeping AI
 * translations consistent.
 */
export function filterDictBySourceText(
  nameDict: Array<{ chinese: string; vietnamese: string }>,
  sourceText: string,
): Array<{ chinese: string; vietnamese: string }> {
  if (!nameDict || nameDict.length === 0 || !sourceText) return [];
  return nameDict.filter((entry) => sourceText.includes(entry.chinese));
}

// ── Trailing Context (Previous Chapter Ending) ──────────────

/**
 * Get the last N non-empty lines from the previous chapter's content.
 * This helps the AI maintain continuity between chapters (matching
 * pronouns, tone, and narrative flow).
 */
async function getPreviousChapterTrailing(
  novelId: string,
  currentChapterOrder: number,
  maxLines: number,
): Promise<string | null> {
  if (currentChapterOrder <= 0 || maxLines <= 0) return null;

  // Find the chapter immediately before this one
  const allChapters = await db.chapters
    .where("novelId")
    .equals(novelId)
    .sortBy("order");

  const prevChapter = allChapters
    .filter((ch) => ch.order < currentChapterOrder)
    .pop();

  if (!prevChapter) return null;

  // Get the active scene(s) of the previous chapter
  const prevScenes = await db.scenes
    .where("[chapterId+isActive]")
    .equals([prevChapter.id, 1])
    .sortBy("order");

  if (prevScenes.length === 0) return null;

  // Take the last scene's content and extract trailing lines
  const lastScene = prevScenes[prevScenes.length - 1];
  if (!lastScene.content?.trim()) return null;

  const lines = lastScene.content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const trailing = lines.slice(-maxLines);
  return trailing.length > 0 ? trailing.join("\n") : null;
}

// ── Main Context Builder ────────────────────────────────────

/**
 * Build translation context: previous chapter summaries + novel metadata.
 * `depth` controls how many chapters and how much detail to include.
 *
 * NEW: Dynamic Dictionary Injection
 * - If both `nameDict` and `sourceText` are provided, the dictionary is
 *   filtered to only include terms that appear in the source text.
 * - This saves 90%+ of tokens compared to sending the full dictionary.
 *
 * NEW: Trailing Context
 * - Includes the last few lines of the previous chapter so the AI can
 *   seamlessly continue the narrative flow.
 */
export async function buildTranslateContext(
  novelId: string,
  currentChapterOrder: number,
  depth: ContextDepth = "standard",
  nameDict?: Array<{ chinese: string; vietnamese: string }>,
  sourceText?: string,
): Promise<string | null> {
  const config = DEPTH_CONFIG[depth];

  const [chapters, novel, characters, trailing] = await Promise.all([
    db.chapters.where("novelId").equals(novelId).sortBy("order"),
    config.includeDetails ? db.novels.get(novelId) : Promise.resolve(undefined),
    config.includeDetails
      ? db.characters.where("novelId").equals(novelId).toArray()
      : Promise.resolve([]),
    getPreviousChapterTrailing(novelId, currentChapterOrder, config.trailingLines),
  ]);

  const parts: string[] = [];
  parts.push(`## Thông tin chương đang dịch\nThứ tự chương: ${currentChapterOrder}`);

  // ⚡ Name Dictionary FIRST (highest priority — character names are most error-prone)
  if (nameDict && nameDict.length > 0) {
    const filteredDict = sourceText
      ? filterDictBySourceText(nameDict, sourceText)
      : nameDict;

    if (filteredDict.length > 0) {
      const nameParts = filteredDict
        .map((e) => `${e.chinese} → ${e.vietnamese}`)
        .join("\n");
      const section = `## ⚠️ BẢNG TÊN RIÊNG — ƯU TIÊN CAO NHẤT (${filteredDict.length} mục)\nĐây là danh sách tên nhân vật, địa danh, thuật ngữ đã được xác nhận. BẮT BUỘC dùng ĐÚNG tên dịch dưới đây, KHÔNG được tự ý đổi hay phiên âm lại:\n${nameParts}`;
      parts.push(section);
    }
  }

  // Novel-level metadata (names for consistency)
  const metaParts: string[] = [];
  if (novel?.title) {
    metaParts.push(`Tiểu thuyết: ${novel.title}`);
  }
  if (novel?.synopsis && config.includeDetails) {
    metaParts.push(`Tóm tắt: ${novel.synopsis}`);
  }
  if (characters.length > 0) {
    metaParts.push(`Nhân vật: ${characters.map((c) => c.name).join(", ")}`);
  }
  if (novel?.keyLocations?.length) {
    metaParts.push(`Địa danh: ${novel.keyLocations.map((l) => l.name).join(", ")}`);
  }
  if (novel?.factions?.length) {
    metaParts.push(`Thế lực: ${novel.factions.map((f) => f.name).join(", ")}`);
  }
  if (novel?.worldOverview && config.includeDetails) {
    metaParts.push(`Thế giới: ${novel.worldOverview}`);
  }
  if (metaParts.length > 0) {
    parts.push(`## Thuật ngữ & tên riêng\n${metaParts.join("\n")}`);
  }

  // Previous chapter summary (only the immediately preceding chapter)
  const previous = chapters
    .filter((ch) => ch.order < currentChapterOrder && ch.summary)
    .slice(-config.maxChapters);

  if (previous.length > 0) {
    const summaries = previous
      .map((ch) => `### ${ch.title}\n${ch.summary}`)
      .join("\n\n");
    parts.push(`## Tóm tắt chương trước\n${summaries}`);
  }

  // Trailing context: last lines of previous chapter for narrative continuity
  if (trailing) {
    parts.push(`## Đoạn cuối chương trước (để nối mạch văn)\n${trailing}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Build minimal context for review/edit: character names + location names.
 * Token-efficient — just a flat list of names.
 */
export async function buildMinimalContext(
  novelId: string,
): Promise<string | null> {
  const [characters, novel] = await Promise.all([
    db.characters.where("novelId").equals(novelId).toArray(),
    db.novels.get(novelId),
  ]);

  const parts: string[] = [];

  if (characters.length > 0) {
    const names = characters.map((c) => c.name).join(", ");
    parts.push(`Nhân vật: ${names}`);
  }

  if (novel?.keyLocations?.length) {
    const locations = novel.keyLocations.map((l) => l.name).join(", ");
    parts.push(`Địa danh: ${locations}`);
  }

  if (novel?.factions?.length) {
    const factions = novel.factions.map((f) => f.name).join(", ");
    parts.push(`Thế lực: ${factions}`);
  }

  return parts.length > 0 ? parts.join("\n") : null;
}
