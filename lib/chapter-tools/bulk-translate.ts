import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db, resolveChapterOriginalTitle } from "@/lib/db";
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
import { cleanGarbageLines, splitBySceneBreak, splitTextIntoParts } from "@/lib/text-utils";
import { useBulkTranslateStore, type TranslateChapterResult, type TranslateError } from "@/lib/stores/bulk-translate";
import { scanNewNames, autoAddNames, scanPronounRelations, autoUpdatePronounPrompt } from "./name-scanner";
import { isSceneTranslated } from "@/lib/novel-io";
import { checkAndIncrementUsage } from "../usage-limits";
import { checkIsVipStandalone } from "../hooks/use-profile";

// ── Retry & Error Handling ──

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 10000; // 10s for rate limits (reduced from 30s for speed)
const RETRY_EMPTY_DELAY = 2000;  // 2s for empty responses (quick transient failure)

/** Classify API errors and decide if they are retryable */
function classifyError(err: unknown): { retryable: boolean; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Rate limit (429)
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return { retryable: true, message: `Rate limit — đang chờ retry... (${msg})` };
  }
  // Server errors (500, 502, 503, 504)
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('504') || lower.includes('server error') || lower.includes('internal error')) {
    return { retryable: true, message: `Server lỗi tạm thời — đang retry... (${msg})` };
  }
  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnreset') || lower.includes('etimedout')) {
    return { retryable: true, message: `Timeout — đang retry... (${msg})` };
  }
  // Network / connection errors (common with third-party proxies like beijixingxing, catiecli)
  if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network') || lower.includes('dns')) {
    return { retryable: true, message: `Lỗi kết nối proxy — đang retry... (${msg})` };
  }
  // Socket / connection dropped
  if (lower.includes('socket hang up') || lower.includes('socket') || lower.includes('epipe') || lower.includes('broken pipe') || lower.includes('ehostunreach') || lower.includes('econnaborted')) {
    return { retryable: true, message: `Mất kết nối — đang retry... (${msg})` };
  }
  // Gateway / upstream errors (proxy-specific)
  if (lower.includes('gateway') || lower.includes('upstream') || lower.includes('proxy') || lower.includes('bad gateway') || lower.includes('service unavailable')) {
    return { retryable: true, message: `Lỗi gateway proxy — đang retry... (${msg})` };
  }
  // SSL / TLS errors
  if (lower.includes('ssl') || lower.includes('tls') || lower.includes('certificate') || lower.includes('cert')) {
    return { retryable: true, message: `Lỗi SSL/TLS — đang retry... (${msg})` };
  }
  // Empty / malformed response (proxy returned HTML error page or empty body)
  if (lower.includes('unexpected end') || lower.includes('unexpected token') || lower.includes('json') || lower.includes('empty') || lower.includes('trống') || lower.includes('no body') || lower.includes('invalid json')) {
    return { retryable: true, message: `Response lỗi/rỗng từ proxy — đang retry... (${msg})` };
  }
  // Generic "failed to" errors
  if (lower.includes('failed to') || lower.includes('request failed') || lower.includes('unable to')) {
    return { retryable: true, message: `Request thất bại — đang retry... (${msg})` };
  }
  // Model locked by another user (423 Locked) — NOT retryable
  if (lower.includes('423') || lower.includes('đang được sử dụng') || lower.includes('locked')) {
    return { retryable: false, message: msg };
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
  // Default: treat as retryable (proxy errors are unpredictable)
  return { retryable: true, message: `Lỗi không xác định — đang retry... (${msg})` };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    if (signal) {
      signal.addEventListener("abort", onAbort);
    }
  });
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
  // Strip "Tiêu đề:" or "Title:" prefix (case-insensitive, handles standard and full-width colons)
  title = title.replace(/^(tiêu đề|title)\s*[:：]\s*/i, "").trim();

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
      versionType: "ai-translate",
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
  models?: LanguageModel[];
  depth: ContextDepth;
  translateTitle: boolean;
  autoSave: boolean;
  settings: AnalysisSettings;
  skipTranslated?: boolean;
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
    models,
    depth,
    translateTitle,
    autoSave,
    settings,
    skipTranslated,
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

  // ── Lookahead name scanning ──
  // When 2+ models are available, dedicate one model for scanning names of the
  // NEXT chapter while the primary model translates the current chapter.
  const allModels = models && models.length > 0 ? models : (model ? [model] : []);
  const nameScanModel = allModels.length >= 2 ? allModels[1] : allModels[0];
  // Track which chapters have already had their names scanned (by lookahead)
  const scannedChapterIds = new Set<string>();

  /** Fire-and-forget: scan names for a chapter and update the shared dict */
  function lookaheadScanNames(chapterId: string) {
    if (scannedChapterIds.has(chapterId)) return; // already scanned
    scannedChapterIds.add(chapterId);

    const scenes = scenesByChapter.get(chapterId) ?? [];
    if (scenes.length === 0) return;

    // Run in background — don't await
    (async () => {
      try {
        const originalContents = await Promise.all(
          scenes.map((s) => getOriginalContent(s.id))
        );
        const joinedContent = originalContents.join("\n\n");

        const newNames = await scanNewNames({
          model: nameScanModel,
          sourceText: joinedContent,
          novelId,
          existingDict: nameDictMap,
          signal,
        });
        if (newNames.length > 0) {
          const added = await autoAddNames(novelId, newNames);
          if (added > 0) {
            for (const n of newNames) {
              nameDictMap.set(n.chinese, n.vietnamese);
            }
            console.log(`[Lookahead] Chương tiếp theo: phát hiện ${added} tên mới`);
          }
        }

        try {
          const newlyScannedPronouns = await scanPronounRelations({
            model: nameScanModel,
            sourceText: joinedContent,
            existingDict: nameDictMap,
            signal,
          });
          if (newlyScannedPronouns.length > 0) {
            await autoUpdatePronounPrompt(novelId, newlyScannedPronouns);
          }
        } catch (scanPronounErr) {
          console.warn("[Lookahead] Lỗi quét xưng hô ngầm:", scanPronounErr);
        }
      } catch {
        // Non-critical — translation will still work, just without pre-scanned names
      }
    })();
  }

  async function processChapter(chapter: typeof chapters[0], model: LanguageModel) {
    onChapterStart(chapter.id, chapter.title);

    try {
      const isVip = await checkIsVipStandalone();
      if (!checkAndIncrementUsage("translate", 1, isVip)) {
        useBulkTranslateStore.getState().pause(novelId);
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: "Hôm nay bạn đã dùng hết giới hạn 100 lượt dịch chương miễn phí. Hãy nâng cấp VIP để dùng không giới hạn!",
        });
        return;
      }

      const scenes = scenesByChapter.get(chapter.id) ?? [];

      if (scenes.length === 0) {
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: "Chương không có nội dung (scene)",
        });
        return;
      }

      const originalTitle = await resolveChapterOriginalTitle(chapter);

      // Check if we should skip already translated chapters
      if (skipTranslated && scenes.some(isSceneTranslated)) {
        console.log(`[BulkTranslate] Bỏ qua chương đã dịch: ${chapter.title}`);
        onChapterComplete({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          originalTitle: originalTitle,
          originalLineCount: 0,
          translatedLineCount: 0,
          scenes: [] // Not touching DB since we skip
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
      // If this chapter was already scanned by lookahead, skip the scan
      if (!scannedChapterIds.has(chapter.id)) {
        scannedChapterIds.add(chapter.id);
        try {
          const newNames = await scanNewNames({
            model: nameScanModel,
            sourceText: joinedContent,
            novelId,
            existingDict: nameDictMap,
            signal,
          });
          if (newNames.length > 0) {
            const added = await autoAddNames(novelId, newNames);
            if (added > 0) {
              for (const n of newNames) {
                nameDictMap.set(n.chinese, n.vietnamese);
              }
              console.log(`[NameScan] Chương "${chapter.title}": phát hiện ${added} tên mới`);
            }
          }

          try {
            const newlyScannedPronouns = await scanPronounRelations({
              model: nameScanModel,
              sourceText: joinedContent,
              existingDict: nameDictMap,
              signal,
            });
            if (newlyScannedPronouns.length > 0) {
              await autoUpdatePronounPrompt(novelId, newlyScannedPronouns);
            }
          } catch (scanPronounErr) {
            console.warn(`[NameScan] Chương "${chapter.title}": Lỗi quét xưng hô:`, scanPronounErr);
          }
        } catch {
          // Non-critical — continue translating even if name scan fails
        }
      }

      // 🔭 Lookahead: if 2+ models, scan names for the NEXT chapter in background
      // while this chapter's translation runs on the primary model
      if (allModels.length >= 2) {
        const nextChapter = chapters[chapters.indexOf(chapter) + 1];
        if (nextChapter) {
          lookaheadScanNames(nextChapter.id);
        }
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
        ? buildTranslateUserPrompt(cleanedJoinedContent, originalTitle, TITLE_SEPARATOR)
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

          // Check for empty response — treat as retryable with short delay
          if (!accumulated.trim()) {
            const emptyErr = new Error("AI trả về nội dung trống — thử lại nhanh...");
            lastError = emptyErr;
            console.warn(`[Translate] Chapter "${chapter.title}" trả về trống (lần ${attempt + 1}). Chờ 5s retry...`);
            await delay(RETRY_EMPTY_DELAY, signal);
            continue;
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

          if (!classified.retryable) {
            throw new Error(classified.message);
          }

          const backoffMs = RETRY_BASE_DELAY;
          console.warn(`[Translate] Lỗi: ${classified.message}. Chờ 30s để thử lại lần ${attempt + 1}...`);
          await delay(backoffMs, signal);
        }
      }

      if (lastError) {
        throw lastError;
      }

      // After all inner retries, if still empty — throw to worker-level retry
      if (!accumulated.trim()) {
        throw new Error("AI trả về nội dung trống sau nhiều lần thử — đang retry toàn bộ chương...");
      }

      // Parse result
      const parsed = parseTranslateResult(accumulated, translateTitle);

      // Split back to scenes
      let sceneResults: { sceneId: string; content: string }[];
      if (isMultiScene) {
        const parts = splitBySceneBreak(parsed.content);
        if (parts.length === scenes.length) {
          sceneResults = scenes.map((s, i) => ({
            sceneId: s.id,
            content: parts[i],
          }));
        } else {
          // Fallback to splitting by paragraph boundaries
          const splitParts = splitTextIntoParts(parsed.content, scenes.length);
          sceneResults = scenes.map((s, i) => ({
            sceneId: s.id,
            content: splitParts[i] || "",
          }));
        }
      } else {
        sceneResults = [{ sceneId: scenes[0].id, content: parsed.content }];
      }

      const chapterResult: TranslateChapterResult = {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        originalTitle: originalTitle,
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
      // Re-throw retryable errors so the worker-level retry loop catches them
      const classified = classifyError(err);
      if (classified.retryable) {
        throw err; // Let worker retry this chapter
      }
      // Non-retryable: report and move on
      onChapterError({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        message: classified.message,
      });
    }
  }

  async function worker() {
    while (currentIndex < chapters.length) {
      if (signal?.aborted) return;

      // Pause loop
      while (useBulkTranslateStore.getState().jobs[novelId]?.isPaused) {
        await delay(1000, signal);
        if (signal?.aborted) return;
      }

      // Get the next chapter index atomically in the async execution context
      const chapterIdx = currentIndex;
      const chapter = chapters[chapterIdx];
      if (!chapter) return;
      currentIndex++;

      // Pick a model if multi-model is provided
      const currentModel = models && models.length > 0
        ? models[chapterIdx % models.length]
        : model;

      // Retry loop for entire chapter processing
      let chapterRetries = 0;
      let chapterSuccess = false;

      while (!chapterSuccess && chapterRetries <= MAX_RETRIES) {
        if (signal?.aborted) return;

        try {
          await processChapter(chapter, currentModel);
          chapterSuccess = true; // processChapter didn't throw = success (or non-retryable error already reported)
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;

          const classified = classifyError(err);
          chapterRetries++;

          if (!classified.retryable || chapterRetries > MAX_RETRIES) {
            // Non-retryable or exhausted retries — report and move on
            onChapterError({
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              message: classified.message,
            });
            chapterSuccess = true; // Move to next chapter
          } else {
            // Retryable — wait 30s and retry this SAME chapter
            console.warn(
              `[BulkTranslate] Chương "${chapter.title}" lỗi (lần ${chapterRetries}): ${classified.message}. Chờ 30s retry...`
            );
            onChapterError({
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              message: `⏳ Retry lần ${chapterRetries}: ${classified.message} — đang chờ 30s...`,
            });
            await delay(RETRY_BASE_DELAY, signal);
          }
        }
      }

      if (delayMs && delayMs > 0 && currentIndex < chapters.length && !signal?.aborted) {
        await delay(delayMs, signal);
      }
    }
  }

  // Start concurrent workers
  const workers = Array.from({ length: Math.min(concurrency, chapters.length) }, () => worker());
  await Promise.all(workers);

  onAllComplete();
}
