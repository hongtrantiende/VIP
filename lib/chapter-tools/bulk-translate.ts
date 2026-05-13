import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db } from "@/lib/db";
import type { AnalysisSettings, Scene } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict } from "@/lib/hooks/use-name-entries";
import type { ContextDepth } from "./context";
import { buildTranslateContext } from "./context";
import {
  resolveChapterToolPrompts,
  buildTranslateTitleNote,
  buildTranslateSceneBreakNote,
  buildTranslateUserPrompt,
} from "./prompts";
import { cleanGarbageLines } from "@/lib/text-utils";
import { useBulkTranslateStore, type TranslateChapterResult, type TranslateError } from "@/lib/stores/bulk-translate";
import { scanNewNames, autoAddNames } from "./name-scanner";

// ── Retry & Error Handling ──

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000; // 2s, 4s, 8s exponential backoff

/** Classify API errors and decide if they are retryable */
function classifyError(err: unknown): { retryable: boolean; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Rate limit (429)
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return { retryable: true, message: `Rate limit — đang chờ retry... (${msg})` };
  }
  // Server errors (500, 502, 503)
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('server error') || lower.includes('internal error')) {
    return { retryable: true, message: `Server lỗi tạm thời — đang retry... (${msg})` };
  }
  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnreset')) {
    return { retryable: true, message: `Timeout — đang retry... (${msg})` };
  }
  // Auth errors (not retryable)
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('authentication')) {
    return { retryable: false, message: `Lỗi xác thực API key — kiểm tra lại cấu hình provider. (${msg})` };
  }
  // Model not found
  if (lower.includes('model not found') || lower.includes('404') || lower.includes('does not exist')) {
    return { retryable: false, message: `Model không tồn tại hoặc không khả dụng. (${msg})` };
  }
  // Insufficient quota
  if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('billing')) {
    return { retryable: false, message: `Hết quota/credit API. Kiểm tra billing. (${msg})` };
  }
  // Content filter
  if (lower.includes('content filter') || lower.includes('safety') || lower.includes('blocked')) {
    return { retryable: false, message: `Nội dung bị chặn bởi bộ lọc an toàn. (${msg})` };
  }
  // Default: try once more
  return { retryable: true, message: msg };
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Shared constants & helpers (also used by translate-mode.tsx) ──

export const TITLE_SEPARATOR = "---";

const SCENE_BREAK = "===SCENE_BREAK===";

export function parseTranslateResult(
  raw: string,
  includeTitle: boolean,
): { title: string | null; content: string } {
  if (!includeTitle) return { title: null, content: raw };

  const sepIndex = raw.indexOf(`\n${TITLE_SEPARATOR}\n`);
  if (sepIndex === -1) return { title: null, content: raw };

  let title = raw.slice(0, sepIndex).trim();
  // Strip XML tags like <chapter_title> if AI accidentally outputs them
  title = title.replace(/<\/?chapter_title>/gi, '').trim();

  let content = raw.slice(sepIndex + TITLE_SEPARATOR.length + 2).trim();
  // Strip other XML tags just in case
  content = content.replace(/<\/?chapter_content>/gi, '').trim();

  return { title: title || null, content };
}

// ── Save helpers ──

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

/** Save a single chapter result with version snapshots. */
async function saveChapterScenes(
  result: TranslateChapterResult,
  timestamp: Date,
) {
  if (result.newTitle) {
    await db.chapters.update(result.chapterId, {
      title: result.newTitle,
      updatedAt: timestamp,
    });
  }
  for (const scene of result.scenes) {
    // Bootstrap v1 (manual) with ORIGINAL content if no versions exist
    const existing = await db.scenes.get(scene.sceneId);
    if (existing) {
      const origContent = await getOriginalContent(scene.sceneId);
      await ensureInitialVersion(scene.sceneId, existing.novelId, origContent);
      // Save the NEW translated content as a version
      await createSceneVersion(scene.sceneId, existing.novelId, "ai-translate", scene.content);
    }
    await db.scenes.update(scene.sceneId, {
      content: scene.content,
      wordCount: countWords(scene.content),
      updatedAt: timestamp,
    });
  }
}

export async function saveChapterResult(result: TranslateChapterResult) {
  await saveChapterScenes(result, new Date());
}

/** Save multiple chapter results in a single transaction. */
export async function saveBulkResults(results: TranslateChapterResult[]) {
  await db.transaction("rw", [db.chapters, db.scenes], async () => {
    const now = new Date();
    for (const result of results) {
      await saveChapterScenes(result, now);
    }
  });
}

// ── Bulk translate engine ──

export interface BulkTranslateOptions {
  novelId: string;
  chapterIds: string[];
  model: LanguageModel;
  depth: ContextDepth;
  translateTitle: boolean;
  autoSave: boolean;
  settings: AnalysisSettings;
  /** Overrides the translate prompt from settings when provided. */
  customPrompt?: string;
  signal?: AbortSignal;
  /** Delay in milliseconds between chapters to avoid rate limits. */
  delayMs?: number;

  onChapterStart: (chapterId: string, chapterTitle: string) => void;
  onChapterComplete: (result: TranslateChapterResult) => void;
  onChapterError: (error: TranslateError) => void;
  onAllComplete: () => void;
}

export async function runBulkTranslate(opts: BulkTranslateOptions): Promise<void> {
  const {
    novelId,
    chapterIds,
    model,
    depth,
    translateTitle,
    autoSave,
    settings,
    customPrompt,
    signal,
    delayMs,
    onChapterStart,
    onChapterComplete,
    onChapterError,
    onAllComplete,
  } = opts;

  const chapterIdSet = new Set(chapterIds);

  // Prefetch chapters + all scenes in 2 queries (not N+1)
  const [allChapters, allScenes] = await Promise.all([
    db.chapters.where("novelId").equals(novelId).sortBy("order"),
    db.scenes.where("[novelId+isActive]").equals([novelId, 1]).toArray(),
  ]);

  const chapters = allChapters.filter((c) => chapterIdSet.has(c.id));

  // Group scenes by chapter
  const scenesByChapter = new Map<string, Scene[]>();
  for (const s of allScenes) {
    if (!chapterIdSet.has(s.chapterId)) continue;
    const arr = scenesByChapter.get(s.chapterId) ?? [];
    arr.push(s);
    scenesByChapter.set(s.chapterId, arr);
  }
  // Sort each group by order
  for (const scenes of scenesByChapter.values()) {
    scenes.sort((a, b) => a.order - b.order);
  }

  // Use novel's scanned custom prompt (genre-aware) > manual override > settings default
  const novel = await db.novels.get(novelId);
  const basePrompt = novel?.customTranslatePrompt?.trim() 
    || customPrompt?.trim() 
    || resolveChapterToolPrompts(settings).translate;

  // Fetch name dictionary once — use a mutable Map so new names discovered
  // during pre-scan can be added and used by subsequent chapters
  const initialDict = await getMergedNameDict(novelId);
  const nameDictMap = new Map(initialDict.map((e) => [e.chinese, e.vietnamese]));

  const concurrency = settings.translateConcurrency && settings.translateConcurrency > 0 ? settings.translateConcurrency : 1;
  let currentIndex = 0;

  async function processChapter(chapter: typeof chapters[0]) {
    onChapterStart(chapter.id, chapter.title);

    try {
      const scenes = scenesByChapter.get(chapter.id) ?? [];

      if (scenes.length === 0) {
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: "Chương không có nội dung (scene)",
        });
        return;
      }

      // Join scene contents — ALWAYS use ORIGINAL content (pre-translation)
      const isMultiScene = scenes.length > 1;
      const originalContents = await Promise.all(
        scenes.map((s) => getOriginalContent(s.id))
      );
      const joinedContent = isMultiScene
        ? originalContents.join(`\n\n${SCENE_BREAK}\n\n`)
        : originalContents[0];

      // ⚡ Pre-scan: detect NEW character names not yet in dictionary
      // Auto-add them before translating so this chapter + all future chapters use them
      try {
        const newNames = await scanNewNames({
          model,
          sourceText: joinedContent,
          novelId,
          existingDict: nameDictMap,
          signal,
        });
        if (newNames.length > 0) {
          const added = await autoAddNames(novelId, newNames);
          if (added > 0) {
            // Update the shared mutable dict so subsequent chapters see these names
            for (const n of newNames) {
              nameDictMap.set(n.chinese, n.vietnamese);
            }
            console.log(`[NameScan] Chương "${chapter.title}": phát hiện ${added} tên mới`);
          }
        }
      } catch {
        // Non-critical — continue translating even if name scan fails
      }

      // Convert current dict Map back to array for context builder
      const currentNameDict = Array.from(nameDictMap, ([chinese, vietnamese]) => ({ chinese, vietnamese }));

      // Build context with dynamic dictionary filtering
      const context = await buildTranslateContext(
        novelId, chapter.order, depth, currentNameDict, joinedContent,
      );

      // Build system prompt
      let systemPrompt = basePrompt;
      if (translateTitle) {
        systemPrompt += buildTranslateTitleNote(TITLE_SEPARATOR);
      }
      if (isMultiScene) {
        systemPrompt += buildTranslateSceneBreakNote(SCENE_BREAK);
      }
      if (context) {
        systemPrompt += `\n\n${context}`;
      }

      // Build user prompt
      const cleanedJoinedContent = cleanGarbageLines(joinedContent);
      const userPrompt = translateTitle
        ? buildTranslateUserPrompt(cleanedJoinedContent, chapter.title, TITLE_SEPARATOR)
        : cleanedJoinedContent;

      // Stream translation with retry logic
      let accumulated = "";
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (signal?.aborted) break;

        try {
          accumulated = "";
          const result = streamText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            abortSignal: signal,
          });

          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              accumulated += part.text ?? "";
            }
          }

          const finishReason = await result.finishReason;
          if (finishReason === "length") {
            console.warn(`Chapter ${chapter.title} may have been truncated.`);
          }

          lastError = null;
          break; // Success — exit retry loop
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") throw err;

          lastError = err;
          const classified = classifyError(err);

          if (!classified.retryable || attempt >= MAX_RETRIES) {
            throw new Error(classified.message);
          }

          const backoffMs = RETRY_BASE_DELAY * Math.pow(2, attempt);
          console.warn(`[Translate] Retry ${attempt + 1}/${MAX_RETRIES} for "${chapter.title}" in ${backoffMs}ms: ${classified.message}`);
          await delay(backoffMs);
        }
      }

      if (lastError) {
        throw lastError;
      }

      if (!accumulated.trim()) {
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: "AI trả về nội dung trống — có thể bị chặn bởi bộ lọc an toàn.",
        });
        return;
      }

      // Parse result
      const parsed = parseTranslateResult(accumulated, translateTitle);

      // Split back to scenes
      let sceneResults: { sceneId: string; content: string }[];
      if (isMultiScene) {
        const parts = parsed.content.split(SCENE_BREAK).map((s) => s.trim());
        if (parts.length === scenes.length) {
          sceneResults = scenes.map((s, i) => ({
            sceneId: s.id,
            content: parts[i],
          }));
        } else {
          // Fallback
          sceneResults = scenes.map((s, i) => ({
            sceneId: s.id,
            content: i === 0 ? parsed.content.replaceAll(SCENE_BREAK, "").trim() : s.content,
          }));
        }
      } else {
        sceneResults = [{ sceneId: scenes[0].id, content: parsed.content }];
      }

      const chapterResult: TranslateChapterResult = {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        originalTitle: chapter.title,
        newTitle: parsed.title ?? undefined,
        originalLineCount: joinedContent.split("\n").length,
        translatedLineCount: parsed.content.split("\n").length,
        scenes: sceneResults,
      };

      onChapterComplete(chapterResult);

      if (autoSave) {
        await saveChapterResult(chapterResult);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // Bubble up abort
      }
      onChapterError({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        message: err instanceof Error ? err.message : "Lỗi không xác định",
      });
    }
  }

  async function worker() {
    while (currentIndex < chapters.length) {
      if (signal?.aborted) return;

      // Pause loop
      while (useBulkTranslateStore.getState().jobs[novelId]?.isPaused) {
        await delay(1000);
        if (signal?.aborted) return;
      }

      // Get the next chapter index atomically in the async execution context
      const chapter = chapters[currentIndex];
      if (!chapter) return;
      currentIndex++;

      await processChapter(chapter);

      if (delayMs && delayMs > 0 && currentIndex < chapters.length && !signal?.aborted) {
        await delay(delayMs);
      }
    }
  }

  // Start concurrent workers
  const workers = Array.from({ length: Math.min(concurrency, chapters.length) }, () => worker());
  await Promise.all(workers);

  onAllComplete();
}
