/**
 * Hybrid Converter AI Engine
 * 
 * Kiến trúc 2 giai đoạn:
 *   Phase 1: Dictionary/STV translate (nhanh, chi phí ~0)
 *   Phase 2: Selective AI post-editing (chỉ sửa tên, ngữ cảnh)
 * 
 * AI nhận bản dịch dictionary + bản gốc → chỉ refine, không dịch lại.
 * Tiết kiệm 70-90% token so với full AI translate.
 */
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { db } from "@/lib/db";
import type { AnalysisSettings, Scene } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict, bulkImportNameEntries } from "@/lib/hooks/use-name-entries";
import { cleanGarbageLines } from "@/lib/text-utils";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { convertText } from "@/lib/hooks/use-qt-engine";
import { PDF_RULES } from "@/lib/ai/pdf-rules";

// ── Constants ──

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

// ── Post-edit system prompt ──

const HYBRID_POST_EDIT_BASE = `# Vai trò
Bạn là biên tập viên văn học chuyên nghiệp. Bạn KHÔNG dịch lại, bạn chỉ SỬA LỖI bản dịch từ điển sẵn có.

# Nhiệm vụ  
Nhận bản dịch từ điển Trung → Việt và văn bản gốc tiếng Trung. Chỉ sửa những chỗ SAI, giữ nguyên phần đã đúng.

# Quy tắc sửa BẮT BUỘC TỪ PDF:
${PDF_RULES}

# Yêu cầu đầu ra (BẮT BUỘC THEO ĐÚNG FORMAT NÀY):
<names>
[names]TênTrung1=TênViệt1
[names]TênTrung2=TênViệt2
[tuvung]ThuậtNgữTrung=ThuậtNgữViệt
[ngucanh]CụmTừTrung=CụmTừViệt
</names>
<content>
(Văn bản dịch đã sửa lỗi)
</content>

Lưu ý QUAN TRỌNG: TRÍCH XUẤT TỪ ĐIỂN theo định dạng \`[loại]TiếngTrung=TiếngViệt\`.
- [names]: Tên nhân vật, địa danh, môn phái
- [tuvung]: Thuật ngữ, kỹ năng, vật phẩm
- [ngucanh]: Ngữ cảnh đặc thù
KHÔNG giải thích. Nếu không có tên nào, để trống giữa <names></names>.`;

function buildGenreAwareSystemPrompt(): string {
  return HYBRID_POST_EDIT_BASE;
}

// ── Types ──

export interface HybridTranslateResult {
  chapterId: string;
  chapterTitle: string;
  originalTitle: string;
  newTitle: string | undefined;
  scenes: { sceneId: string; content: string }[];
  extractedNamesCount: number;
}

export interface HybridTranslateError {
  chapterId: string;
  chapterTitle: string;
  message: string;
}

export interface HybridTranslateOptions {
  novelId: string;
  chapterIds: string[];
  model: LanguageModel;
  targetGenres?: string[];
  signal?: AbortSignal;
  delayMs?: number;

  onPhase: (chapterId: string, phase: "dict" | "ai" | "done") => void;
  onChapterStart: (chapterId: string, chapterTitle: string) => void;
  onChapterComplete: (result: HybridTranslateResult) => void;
  onChapterError: (error: HybridTranslateError) => void;
  onAllComplete: () => void;
}

// ── Helpers ──

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyError(err: unknown): { retryable: boolean; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return { retryable: true, message: `Rate limit — retry... (${msg})` };
  }
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('server error')) {
    return { retryable: true, message: `Server lỗi tạm — retry... (${msg})` };
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnreset')) {
    return { retryable: true, message: `Timeout — retry... (${msg})` };
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
    return { retryable: false, message: `Lỗi xác thực API key. (${msg})` };
  }
  if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('billing')) {
    return { retryable: false, message: `Hết quota API. (${msg})` };
  }
  return { retryable: true, message: msg };
}

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

// ── Build AI post-edit prompt with dictionary context ──

function buildPostEditPrompt(
  chineseText: string,
  dictTranslation: string,
  nameDict: Array<{ chinese: string; vietnamese: string }>,
): string {
  let prompt = buildGenreAwareSystemPrompt();

  // Add name dictionary context
  const relevantNames = nameDict.filter(
    (n) => chineseText.includes(n.chinese)
  );
  if (relevantNames.length > 0) {
    prompt += `\n\n# Bảng tên riêng (BẮT BUỘC dùng đúng)\n`;
    for (const n of relevantNames.slice(0, 100)) {
      prompt += `${n.chinese} → ${n.vietnamese}\n`;
    }
  }

  return prompt;
}

function buildPostEditUserPrompt(
  chineseText: string,
  dictTranslation: string,
  chineseTitle?: string,
  dictTitle?: string,
): string {
  let user = "";
  
  if (chineseTitle && dictTitle) {
    user += `Tiêu đề: ${chineseTitle} → ${dictTitle}\n---\n`;
  }
  
  user += `[GỐC]\n${chineseText}\n\n[DỊCH TỪ ĐIỂN]\n${dictTranslation}\n\nHãy phân tích và trả về <names> (nếu tìm thấy tên mới) và <content> đã sửa lỗi theo format yêu cầu.`;
  
  return user;
}

function parseHybridResult(
  raw: string,
  includeTitle: boolean,
): { title: string | null; content: string; extractedNames: Array<{chinese: string, vietnamese: string, dictType: string}> } {
  let contentPart = raw;
  let extractedNames: Array<{chinese: string, vietnamese: string, dictType: string}> = [];

  // Extract <names> block if present
  const namesMatch = raw.match(/<names>([\s\S]*?)<\/names>/i);
  if (namesMatch) {
    const lines = namesMatch[1].trim().split("\n");
    for (let line of lines) {
      if (line.includes("=")) {
        line = line.trim();
        const tagMatch = line.match(/^\[(\w+)\]/);
        const dictType = tagMatch ? tagMatch[1] : "names";
        const cleanedLine = tagMatch ? line.slice(tagMatch[0].length) : line;
        const [cn, vn] = cleanedLine.split("=").map(s => s.trim());
        if (cn && vn && cn !== vn) {
          extractedNames.push({ chinese: cn, vietnamese: vn, dictType });
        }
      }
    }
  }

  // Extract <content> block if present
  const contentMatch = raw.match(/<content>([\s\S]*?)<\/content>/i);
  if (contentMatch) {
    contentPart = contentMatch[1].trim();
  } else {
    // Fallback if AI didn't use <content> tags
    contentPart = raw.replace(/<names>[\s\S]*?<\/names>/gi, "").trim();
  }

  if (!includeTitle) return { title: null, content: contentPart, extractedNames };

  const sepIndex = contentPart.indexOf("\n---\n");
  if (sepIndex === -1) return { title: null, content: contentPart, extractedNames };

  const title = contentPart.slice(0, sepIndex).trim();
  const textBody = contentPart.slice(sepIndex + 5).trim();
  return { title: title || null, content: textBody, extractedNames };
}

// ── Main hybrid engine ──

export async function runPdfTranslate(opts: HybridTranslateOptions): Promise<void> {
  const {
    novelId,
    chapterIds,
    model,
    targetGenres,
    signal,
    delayMs,
    onPhase,
    onChapterStart,
    onChapterComplete,
    onChapterError,
    onAllComplete,
  } = opts;

  const chapterIdSet = new Set(chapterIds);

  // Prefetch all data
  const [allChapters, allScenes] = await Promise.all([
    db.chapters.where("novelId").equals(novelId).sortBy("order"),
    db.scenes.where("[novelId+isActive]").equals([novelId, 1]).toArray(),
  ]);

  const chapters = allChapters.filter((c) => chapterIdSet.has(c.id));

  // Initialize global store for UI
  const store = useBulkTranslateStore.getState();
  store.initJob(novelId);
  store.start(novelId, chapterIds, undefined, undefined);

  // Group scenes by chapter
  const scenesByChapter = new Map<string, Scene[]>();
  for (const s of allScenes) {
    if (!chapterIdSet.has(s.chapterId)) continue;
    const arr = scenesByChapter.get(s.chapterId) ?? [];
    arr.push(s);
    scenesByChapter.set(s.chapterId, arr);
  }
  for (const scenes of scenesByChapter.values()) {
    scenes.sort((a, b) => a.order - b.order);
  }

  // Fetch initial name dictionary
  let nameDict = await getMergedNameDict(novelId);

  // Fetch novel's custom translate prompt (from genre scan)
  const novel = await db.novels.get(novelId);

  let isFirst = true;

  for (const chapter of chapters) {
    if (signal?.aborted) break;

    // Delay between chapters
    if (!isFirst && delayMs && delayMs > 0) {
      await delay(delayMs);
    }
    isFirst = false;

    if (signal?.aborted) break;

    // Pause loop
    while (useBulkTranslateStore.getState().jobs[novelId]?.isPaused) {
      await delay(1000);
      if (signal?.aborted) break;
    }
    if (signal?.aborted) break;

    store.setCurrentChapter(novelId, chapter.id);
    store.setChapterStatus(novelId, chapter.id, "translating");
    onChapterStart(chapter.id, chapter.title);

    try {
      const scenes = scenesByChapter.get(chapter.id) ?? [];
      if (scenes.length === 0) {
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: "Chương không có nội dung (scene)",
        });
        store.setChapterStatus(novelId, chapter.id, "error");
        store.addError(novelId, {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: "Chương không có nội dung (scene)",
        });
        store.incrementCompleted(novelId);
        continue;
      }

      // Join scene contents — ALWAYS use ORIGINAL content (pre-translation)
      const SCENE_BREAK = "===SCENE_BREAK===";
      const isMultiScene = scenes.length > 1;
      const originalContents = await Promise.all(
        scenes.map((s) => getOriginalContent(s.id))
      );
      const joinedContent = isMultiScene
        ? originalContents.join(`\n\n${SCENE_BREAK}\n\n`)
        : originalContents[0];

      const cleanedContent = cleanGarbageLines(joinedContent);

      // ═══════════════════════════════════════════
      // PHASE 1: Dictionary/QT Translation (fast)
      // ═══════════════════════════════════════════
      onPhase(chapter.id, "dict");

      let dictTranslatedTitle: string;
      let dictTranslatedContent: string;

      try {
        let autoGenres: string[] = [];
        if (novel?.genre) {
          const gLower = novel.genre.toLowerCase();
          const GENRE_LABELS: Record<string, string> = {
            ngontinh: "Ngôn tình", hiendai: "Hiện đại", tienhiep: "Tiên hiệp",
            huyenhuyen: "Huyền huyễn", dammi: "Đam mỹ", hocduong: "Học đường",
            nsfw: "NSFW (18+)", hentai: "Hentai", dongphuong: "Đông phương",
            dothi: "Đô thị", vongdu: "Võng du", khoahuyen: "Khoa huyễn",
            quybi: "Quỷ bí", xuyenkhong: "Xuyên không", hethong: "Hệ thống",
            trinhtham: "Trinh thám", lichsu: "Lịch sử"
          };
          let matchedKey = "tienhiep";
          for (const [key, label] of Object.entries(GENRE_LABELS)) {
            if (gLower === label.toLowerCase() || gLower.includes(label.toLowerCase())) {
              matchedKey = key;
              break;
            }
          }
          autoGenres = [matchedKey];
        }

        const finalGenres = targetGenres && targetGenres.length > 0 && !targetGenres.includes("auto") 
          ? targetGenres 
          : autoGenres;
        const activeSources = finalGenres;
        
        const titleRes = await convertText(chapter.title, {
          options: {
            activeDictSources: activeSources,
          }
        });
        dictTranslatedTitle = titleRes.plainText;
        
        const contentRes = await convertText(cleanedContent, {
          options: {
            activeDictSources: activeSources,
          }
        });
        dictTranslatedContent = contentRes.plainText;
        
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        // If QT fails, skip to error
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: `Từ điển dịch thất bại: ${err instanceof Error ? err.message : "Lỗi"}`,
        });
        store.setChapterStatus(novelId, chapter.id, "error");
        store.addError(novelId, {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: `Từ điển dịch thất bại: ${err instanceof Error ? err.message : "Lỗi"}`,
        });
        store.incrementCompleted(novelId);
        continue;
      }

      if (signal?.aborted) break;

      // ═══════════════════════════════════════════
      // PHASE 2: AI Post-Edit (selective refine)
      // ═══════════════════════════════════════════
      onPhase(chapter.id, "ai");

      const systemPrompt = buildPostEditPrompt(
        cleanedContent,
        dictTranslatedContent,
        nameDict,
      );

      const userPrompt = buildPostEditUserPrompt(
        cleanedContent,
        dictTranslatedContent,
        chapter.title,
        dictTranslatedTitle,
      );

      let accumulated = "";
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (signal?.aborted) break;

        try {
          const result = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            abortSignal: signal,
          });

          accumulated = result.text ?? "";
          lastError = null;
          break;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") throw err;

          lastError = err;
          const classified = classifyError(err);

          if (!classified.retryable || attempt >= MAX_RETRIES) {
            // AI failed → fall back to dictionary-only result
            console.warn(`[HybridTranslate] AI post-edit failed for "${chapter.title}", using dictionary only: ${classified.message}`);
            accumulated = "";
            lastError = null;
            break;
          }

          const backoffMs = RETRY_BASE_DELAY * Math.pow(2, attempt);
          await delay(backoffMs);
        }
      }

      // Use AI result if available, otherwise dictionary result
      let parsedTitle: string | null = null;
      let parsedScenes: { sceneId: string; content: string }[] = [];
      let extractedNamesCount = 0;

      if (accumulated.trim()) {
        const parsed = parseHybridResult(accumulated, true);
        parsedTitle = parsed.title;
        
        // Save extracted names to novel dictionary dynamically
        if (parsed.extractedNames.length > 0) {
          try {
            const entriesWithCategory = parsed.extractedNames.map((entry) => {
              let category = "khác";
              if (entry.dictType === "names") category = "nhân vật";
              else if (entry.dictType === "tuvung") category = "thuật ngữ";
              else if (entry.dictType === "ngucanh") category = "context mapping";
              return { ...entry, category };
            });

            await bulkImportNameEntries(novelId, entriesWithCategory, "khác", "skip");
            extractedNamesCount = parsed.extractedNames.length;
            // Update nameDict for subsequent chapters in the loop
            nameDict = await getMergedNameDict(novelId);

            // Upload to community dictionary
            const novel = await db.novels.get(novelId);
            const rawGenre = novel?.genre || (novel?.genres && novel.genres[0]) || "tienhiep";
            const { uploadToCommunityDict } = await import("@/lib/hooks/use-dict-entries");
            await uploadToCommunityDict(entriesWithCategory, rawGenre);
          } catch (err) {
            console.error("Lỗi lưu tên mới vào từ điển:", err);
          }
        }

        const finalContent = parsed.content || dictTranslatedContent;
        if (isMultiScene) {
          const parts = finalContent.split(SCENE_BREAK).map((s) => s.trim());
          parsedScenes = scenes.map((s, i) => ({
            sceneId: s.id,
            content: parts[i] || s.content,
          }));
        } else {
          parsedScenes = [{ sceneId: scenes[0].id, content: finalContent }];
        }
      } else {
        parsedTitle = dictTranslatedTitle;
        parsedScenes = scenes.map((s, i) => ({
          sceneId: s.id,
          content: isMultiScene ? dictTranslatedContent.split(SCENE_BREAK)[i]?.trim() || s.content : dictTranslatedContent,
        }));
      }

      onPhase(chapter.id, "done");

      // Auto-save
      const now = new Date();
      if (parsedTitle) {
        await db.chapters.update(chapter.id, { title: parsedTitle, updatedAt: now });
      }
      for (const scene of parsedScenes) {
        const existing = await db.scenes.get(scene.sceneId);
        if (existing) {
          const origContent = await getOriginalContent(scene.sceneId);
          await ensureInitialVersion(scene.sceneId, existing.novelId, origContent);
          await createSceneVersion(scene.sceneId, existing.novelId, "hybrid-converter", scene.content);
        }
        await db.scenes.update(scene.sceneId, {
          content: scene.content,
          wordCount: countWords(scene.content),
          updatedAt: now,
        });
      }

      onChapterComplete({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        originalTitle: chapter.title,
        newTitle: parsedTitle ?? chapter.title,
        scenes: parsedScenes,
        extractedNamesCount,
      });

      store.setChapterStatus(novelId, chapter.id, "done");
      store.addResult(novelId, {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        originalTitle: chapter.title,
        newTitle: parsedTitle ?? chapter.title,
        originalLineCount: 0,
        translatedLineCount: 0,
        scenes: parsedScenes,
      });
      store.incrementCompleted(novelId);

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") break;
      const msg = err instanceof Error ? err.message : "Lỗi không xác định";
      onChapterError({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        message: msg,
      });
      store.setChapterStatus(novelId, chapter.id, "error");
      store.addError(novelId, {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        message: msg,
      });
      store.incrementCompleted(novelId);
    }
  }

  if (signal?.aborted) {
    store.cancel(novelId);
  } else {
    store.finish(novelId);
    onAllComplete();
  }
}
