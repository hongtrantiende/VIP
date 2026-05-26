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
import { generateText, streamText } from "ai";
import type { LanguageModel } from "ai";
import { db, resolveChapterOriginalTitle } from "@/lib/db";
import type { AnalysisSettings, Scene } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict, bulkImportNameEntries } from "@/lib/hooks/use-name-entries";
import { cleanGarbageLines, chunkText, isVietnameseText, splitBySceneBreak, splitTextIntoParts } from "@/lib/text-utils";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { scanNewNames, autoAddNames, scanPronounRelations, autoUpdatePronounPrompt } from "./name-scanner";
import { buildQaSystemPrompt, buildQaUserPrompt, parseQaAndApply } from "./qa-helper";

import { isSceneTranslated } from "@/lib/novel-io";

// ── Constants ──

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

// ── Post-edit system prompt ──

const HYBRID_POST_EDIT_BASE = `# Vai trò
Bạn là biên tập viên văn học chuyên nghiệp. Bạn KHÔNG dịch lại, bạn chỉ SỬA LỖI bản dịch từ điển sẵn có.

# Nhiệm vụ  
Nhận bản dịch từ điển Trung → Việt và văn bản gốc tiếng Trung. Chỉ sửa những chỗ SAI, giữ nguyên phần đã đúng. Kết quả cuối cùng PHẢI là TIẾNG VIỆT.
NGHIÊM CẤM sử dụng bất kỳ định dạng Markdown nào (như in đậm **, tiêu đề ###, hoặc bảng biểu). Chỉ xuất văn bản thuần túy.

# Quy tắc sửa BẮT BUỘC
1. **Tên nhân vật/địa danh/vũ khí**: Sửa tên bị dịch sai/dịch nghĩa. Phải phiên âm Hán-Việt CHUẨN. Viết hoa chữ cái đầu mỗi từ (ví dụ: Tô Dật, Thanh Đường, Cửu Ngục Kiếm).
2. **Xưng hô**: PHẢI đi theo thể loại và phong cách truyện. Truyện tiên hiệp dùng ta/ngươi, tại hạ, bản tọa, sư huynh/sư đệ. Truyện đô thị dùng tôi/anh/cậu.
3. **Ngữ cảnh**: Sửa câu bị dịch sai nghĩa do thiếu ngữ cảnh (đại từ nhầm, quan hệ nhầm).
4. **Văn phong**: Sửa câu cứng/lủng củng cho tự nhiên hơn nhưng giữ đúng phong cách thể loại. KHÔNG thuần Việt hóa quá mức — giữ hơi thở nguyên tác.
5. **Bản dịch đầy đủ 100% (Tuyệt đối không tóm tắt)**: Biên tập trọn vẹn toàn bộ nội dung, không được lược dịch, không tóm tắt ý và không bỏ sót bất kỳ câu chữ nào.
6. **Giữ nguyên dấu phân cảnh**: Nếu có các dấu phân cách phân cảnh (như \`===SCENE_BREAK===\`), bạn BẮT BUỘC phải giữ nguyên chính xác 100% vị trí và định dạng của các dấu này, không thay đổi, không dịch nghĩa, không tự viết lại.
7. **Nếu có bảng tên riêng**: BẮT BUỘC dùng đúng tên dịch đã cho, KHÔNG tự ý đổi.

# Yêu cầu đầu ra (BẮT BUỘC THEO ĐÚNG FORMAT NÀY):
<content>
(Văn bản dịch TIẾNG VIỆT đã sửa lỗi — KHÔNG PHẢI tiếng Anh. TUYỆT ĐỐI KHÔNG chứa ký tự ** hay ###)
</content>

Lưu ý QUAN TRỌNG: Chỉ trả về nội dung dịch đặt trong thẻ <content>...</content>. KHÔNG giải thích gì thêm.`;

/**
 * Build genre-aware post-edit prompt.
 * If novel has a scanned custom prompt (from scanNovelStyle), use it as context.
 */
function buildGenreAwareSystemPrompt(
  novelCustomPrompt?: string,
  globalTranslatePrompt?: string,
): string {
  let prompt = globalTranslatePrompt?.trim() || HYBRID_POST_EDIT_BASE;

  if (novelCustomPrompt?.trim()) {
    prompt += `\n\n# BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI PROMPT DỊCH / XƯNG HÔ / THỂ LOẠI SAU (ƯU TIÊN CAO NHẤT, TUYỆT ĐỐI KHÔNG TỰ Ý THÊM BỚT):\n${novelCustomPrompt.trim()}`;
  }

  return prompt;
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
  models?: LanguageModel[];
  dictModel?: LanguageModel; // Model 2 (Flash)
  qaModel?: LanguageModel;     // Model 3 (Audit)
  qaEnabled?: boolean;         // Check if QA Bot is enabled
  qaPrompt?: string;           // Custom Prompt for QA Bot
  extractDict?: boolean;
  cleanGarbage?: boolean;
  skipTranslated?: boolean;
  continuousMode?: boolean;
  globalTranslatePrompt?: string;
  errorAction?: "stop" | "skip"; // "stop" = dừng lại khi lỗi, "skip" = bỏ qua chương lỗi
  signal?: AbortSignal;
  delayMs?: number;

  onPhase: (chapterId: string, phase: "dict" | "ai" | "done" | "model1" | "model2" | "model3") => void;
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

  // Mọi lỗi đều cho phép thử lại để đảm bảo không mất chương
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
    return { retryable: true, message: `Lỗi xác thực/API Key - Thử lại...` };
  }
  if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('billing')) {
    return { retryable: true, message: `Hết tiền/Quota - Đợi để thử lại...` };
  }

  return { retryable: true, message: msg };
}

const PERSISTENT_RETRY_DELAY = 5000; // 5 giây
const MAX_PERSISTENT_ATTEMPTS = 9999; // Thử lại vô hạn lần

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

const extractionCache = new Set<string>();

async function triggerBackgroundLookahead(novelId: string, chapterId: string, model: LanguageModel, signal?: AbortSignal) {
  if (extractionCache.has(chapterId)) return;
  extractionCache.add(chapterId);

  try {
    console.log(`[Lookahead] Kích hoạt quét ngầm tên cho chương tiếp theo...`);
    const scenes = await db.scenes.where("chapterId").equals(chapterId).toArray();
    if (scenes.length === 0) return;
    scenes.sort((a, b) => a.order - b.order);

    const contents = await Promise.all(scenes.map(s => getOriginalContent(s.id)));
    const combinedText = contents.join("\n\n") + "\n\n";
    const cleaned = cleanGarbageLines(combinedText);

    if (cleaned.trim()) {
      const prompt = `Trích xuất toàn bộ tên riêng (nhân vật chính/phụ, địa danh, môn phái) từ văn bản tiếng Trung sau. 
BẮT BUỘC trả về đúng định dạng JSON Array: [{"chinese": "tên tiếng Trung", "vietnamese": "Hán Việt", "dictType": "names"}]. 
CẤM DỊCH NỘI DUNG. CHỈ TRẢ VỀ JSON, KHÔNG GIẢI THÍCH GÌ THÊM.

[VĂN BẢN]
${cleaned}`;

      const result = await streamText({
        model,
        system: "Bạn là chuyên gia trích xuất thực thể tiếng Trung và phiên âm Hán-Việt. Luôn trả về đúng định dạng JSON Array chứa các đối tượng có thuộc tính chinese (chữ Hán gốc), vietnamese (phiên âm Hán-Việt chuẩn), và dictType (phân loại: 'names', 'tuvung', 'ngucanh'). KHÔNG trả về định dạng mảng chuỗi đơn giản. KHÔNG trích xuất đại từ nhân xưng hay từ thông dụng.",
        prompt,
        abortSignal: signal,
      });

      let rawText = "";
      for await (const chunk of result.textStream) {
        rawText += chunk;
      }

      rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
      const match = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr) && arr.length > 0) {
          const validNames = arr.filter((n: any) => n.chinese && n.vietnamese && typeof n.chinese === "string" && /[\u4e00-\u9fa5]/.test(n.chinese));
          if (validNames.length > 0) {
            console.log(`[Lookahead] Đã trích xuất ngầm ${validNames.length} từ cho chương tiếp theo.`);
            const entriesWithCategory = validNames.map((entry: any) => ({
              ...entry,
              category: entry.dictType === "names" ? "nhân vật" : "khác",
              dictType: entry.dictType || "names"
            }));
            await bulkImportNameEntries(novelId, entriesWithCategory, "khác", "skip");
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    console.warn(`[Lookahead] Lỗi quét ngầm:`, e);
  }
}

// ── Build AI post-edit prompt with dictionary context ──

function buildPostEditPrompt(
  chineseText: string,
  dictTranslation: string,
  nameDict: Array<{ chinese: string; vietnamese: string; category: string }>,
  novelCustomPrompt?: string,
  globalTranslatePrompt?: string,
): string {
  let prompt = buildGenreAwareSystemPrompt(novelCustomPrompt, globalTranslatePrompt);

  // Add name dictionary context
  const relevantNames = nameDict.filter(
    (n) => chineseText.includes(n.chinese) &&
      ["nhân vật", "địa danh", "môn phái", "bang hội", "tên riêng", "thuật ngữ", "context mapping", "khác", "tuvung", "ngucanh"].includes(n.category)
  ).sort((a, b) => b.chinese.length - a.chinese.length);
  if (relevantNames.length > 0) {
    prompt += `\n\n# Bảng tên riêng (BẮT BUỘC dùng đúng)\n`;
    for (const n of relevantNames.slice(0, 150)) {
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
  novelCustomPrompt?: string,
): string {
  let customInstructions = "";
  if (novelCustomPrompt && novelCustomPrompt.trim()) {
    customInstructions = `\n\n⚠️ LƯU Ý BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI PROMPT DỊCH / XƯNG HÔ / PHONG CÁCH (Nghiêm cấm tự ý thêm bớt):\n${novelCustomPrompt.trim()}\n\n`;
  }

  let user = "";

  if (chineseTitle && dictTitle) {
    user += `Tiêu đề: ${chineseTitle} → ${dictTitle}\n---\n`;
  }

  user += `[GỐC]\n${chineseText}\n\n[DỊCH TỪ ĐIỂN]\n${dictTranslation}\n\nHãy dịch trực tiếp sang TIẾNG VIỆT, trả về bản dịch đặt trong cặp thẻ <content>...</content>.
⚠️ LƯU Ý 1: NGHIÊM CẤM dùng định dạng Markdown (**, ###) bên trong thẻ <content>.
⚠️ LƯU Ý 2: TUYỆT ĐỐI TUÂN THỦ CÁCH XƯNG HÔ ĐÃ QUY ĐỊNH BÊN TRÊN! Không được dịch bừa!${customInstructions}`;

  return user;
}

function parseHybridResult(
  raw: string,
  includeTitle: boolean,
): { title: string | null; content: string; extractedNames: Array<{ chinese: string, vietnamese: string, dictType: string }> } {
  let contentPart = raw;
  let extractedNames: Array<{ chinese: string, vietnamese: string, dictType: string }> = [];

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
          if (/[\u4e00-\u9fa5]/.test(cn)) {
            extractedNames.push({ chinese: cn, vietnamese: vn, dictType });
          }
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

  // Loại bỏ các markdown block nếu AI tự động chèn vào
  contentPart = contentPart.replace(/^```[\s\S]*?\n/g, "").replace(/```$/g, "").trim();
  // Loại bỏ ký tự in đậm ** và ###
  contentPart = contentPart.replace(/\*\*/g, "").replace(/^###\s+/gm, "").trim();

  if (!includeTitle) return { title: null, content: contentPart, extractedNames };

  const titleSepMatch = contentPart.match(/\r?\n\s*(?:[-=*#~—]{3,})\s*\r?\n/);
  if (!titleSepMatch) return { title: null, content: contentPart, extractedNames };

  const sepIndex = titleSepMatch.index!;
  const sepLength = titleSepMatch[0].length;

  let title = contentPart.slice(0, sepIndex).trim();
  // Strip "Tiêu đề:" or "Title:" prefix (case-insensitive, handles standard and full-width colons)
  title = title.replace(/^(tiêu đề|title)\s*[:：]\s*/i, "").trim();

  // Bảo vệ: Nếu title chứa xuống dòng (nhiều dòng) hoặc quá dài, đó không phải là title thật
  if (title.includes("\n") || title.length > 200) {
    return { title: null, content: contentPart, extractedNames };
  }

  const textBody = contentPart.slice(sepIndex + sepLength).trim();
  return { title: title || null, content: textBody, extractedNames };
}

// ── Main hybrid engine ──

export async function runHybridTranslate(opts: HybridTranslateOptions): Promise<void> {
  const {
    novelId,
    chapterIds,
    model: defaultModel,
    models,
    dictModel,
    qaModel,
    qaEnabled,
    extractDict,
    cleanGarbage = true,
    skipTranslated,
    continuousMode,
    globalTranslatePrompt,
    signal,
    delayMs,
    onPhase,
    onChapterStart,
    onChapterComplete,
    onChapterError,
    onAllComplete,
  } = opts;

  const chapterIdSet = new Set(chapterIds);

  // Initialize global store for UI
  const store = useBulkTranslateStore.getState();
  store.initJob(novelId);
  store.start(novelId, chapterIds, undefined, undefined);

  // Fetch initial name dictionary
  let nameDict = await getMergedNameDict(novelId);

  // Fetch novel's custom translate prompt (from genre scan)
  const novel = await db.novels.get(novelId);
  const novelCustomPrompt = novel?.customStvPrompt;

  let isFirst = true;

  // ── Auto Initial Dictionary Scan (Khởi động từ điển) ──
  if (extractDict && nameDict.length === 0 && !signal?.aborted) {
    try {
      console.log("[Cold Start Hybrid] Từ điển trống, tiến hành quét 1 chương đầu...");
      const allChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
      const firstChapter = allChapters.slice(0, 1);
      if (firstChapter.length > 0) {
        let combinedText = "";
        for (const c of firstChapter) {
          const chapSc = await db.scenes.where("chapterId").equals(c.id).toArray();
          chapSc.sort((a, b) => a.order - b.order);
          const contents = await Promise.all(chapSc.map(s => getOriginalContent(s.id)));
          combinedText += contents.join("\n\n") + "\n\n";
        }

        // Quét toàn bộ nội dung chương để đảm bảo không lọt từ vựng
        const cleaned = cleanGarbage ? cleanGarbageLines(combinedText) : combinedText;

        if (cleaned.trim()) {
          const prompt = `Trích xuất toàn bộ tên riêng (nhân vật chính/phụ, địa danh, môn phái) từ văn bản tiếng Trung sau. 
BẮT BUỘC trả về đúng định dạng JSON Array: [{"chinese": "tên tiếng Trung", "vietnamese": "Hán Việt", "dictType": "names"}]. 
CẤM DỊCH NỘI DUNG. CHỈ TRẢ VỀ JSON, KHÔNG GIẢI THÍCH GÌ THÊM.

[VĂN BẢN]
${cleaned}`;

          onPhase?.(firstChapter[0].id, "model2"); // Tận dụng UI báo hiệu đang quét từ điển
          const result = await streamText({
            model: dictModel || defaultModel,
            system: "Bạn là chuyên gia trích xuất thực thể tiếng Trung và phiên âm Hán-Việt. Luôn trả về đúng định dạng JSON Array chứa các đối tượng có thuộc tính chinese (chữ Hán gốc), vietnamese (phiên âm Hán-Việt chuẩn), và dictType (phân loại: 'names', 'tuvung', 'ngucanh'). KHÔNG trả về định dạng mảng chuỗi đơn giản. KHÔNG trích xuất đại từ nhân xưng hay từ thông dụng.",
            prompt,
            abortSignal: signal,
          });

          // Tiêu thụ luồng thay vì dùng generateText (do một số API Proxy không hỗ trợ non-streaming)
          let rawText = "";
          for await (const chunk of result.textStream) {
            rawText += chunk;
          }

          rawText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
          try {
            const match = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (match) {
              const arr = JSON.parse(match[0]);
              if (Array.isArray(arr) && arr.length > 0) {
                const validNames = arr.filter((n: any) => n.chinese && n.vietnamese && typeof n.chinese === "string" && /[\u4e00-\u9fa5]/.test(n.chinese));
                if (validNames.length > 0) {
                  console.log(`[Cold Start Hybrid] Quét được ${validNames.length} từ. Cập nhật vào từ điển truyện...`);
                  await bulkImportNameEntries(novelId, validNames, "khác", "skip");
                  nameDict = await getMergedNameDict(novelId);
                }
              }
            }
          } catch (e) {
            console.warn("[Cold Start Hybrid] Lỗi parse JSON từ AI:", e);
          }
        }
      }
    } catch (e) {
      console.warn("[Cold Start Hybrid] Bỏ qua lỗi quét từ điển ban đầu:", e);
    }
  }

  let processedIds = new Set<string>();
  let pollingAttempts = 0;
  let currentTranslateIdx = 0;
  const scannedChapterIds = new Set<string>();
  let targetChapterIds: string[] = [];

  // background dictionary scanner worker (AI 2)
  const runDictWorker = async () => {
    let scanIdx = 0;
    while (true) {
      if (signal?.aborted) break;

      // Pause loop
      while (store.jobs[novelId]?.isPaused) {
        await delay(500);
        if (signal?.aborted) break;
      }
      if (signal?.aborted) break;

      // Dynamically fetch target chapters to handle additions
      const allChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
      let currentQueue: string[] = [];
      if (continuousMode) {
        const startIndex = allChapters.findIndex(c => chapterIdSet.has(c.id));
        const startIdx = startIndex >= 0 ? startIndex : 0;
        currentQueue = allChapters.slice(startIdx).map(c => c.id);
      } else {
        currentQueue = allChapters.filter(c => chapterIdSet.has(c.id)).map(c => c.id);
      }
      targetChapterIds = currentQueue;

      if (scanIdx >= currentQueue.length) {
        await delay(1000);
        continue;
      }

      // Block if AI 2 gets > 2 chapters ahead of AI 1
      while (scanIdx >= currentTranslateIdx + 2) {
        await delay(100);
        if (signal?.aborted) break;
      }
      if (signal?.aborted) break;

      const chapId = currentQueue[scanIdx];
      if (scannedChapterIds.has(chapId)) {
        scanIdx++;
        continue;
      }

      const chapter = await db.chapters.get(chapId);
      if (!chapter) {
        scannedChapterIds.add(chapId);
        scanIdx++;
        continue;
      }

      // Check skipTranslated
      const scenes = await db.scenes.where("chapterId").equals(chapId).toArray();
      if (skipTranslated && scenes.some(isSceneTranslated)) {
        scannedChapterIds.add(chapId);
        scanIdx++;
        continue;
      }

      if (!extractDict) {
        scannedChapterIds.add(chapId);
        scanIdx++;
        continue;
      }

      // Perform Model 2 scan
      store.setChapterStatus(novelId, chapId, "scanning");
      try {
        console.log(`[3-Model Concurrent Pipeline] AI 2 Quét từ điển trước cho chương: ${chapter.title}`);
        const existingDictEntries = await getMergedNameDict(novelId);
        const existingDictMap = new Map(existingDictEntries.map(e => [e.chinese, e.vietnamese]));

        // Load original scene contents
        scenes.sort((a, b) => a.order - b.order);
        const originalContents = await Promise.all(scenes.map((s) => getOriginalContent(s.id)));
        const joinedContent = originalContents.join(`\n\n===SCENE_BREAK===\n\n`);
        const cleanedContent = cleanGarbage ? cleanGarbageLines(joinedContent) : joinedContent;

        // Find primary model index
        const chapterIndex = allChapters.findIndex(c => c.id === chapId);
        const resolvedIndex = chapterIndex >= 0 ? chapterIndex : scanIdx;
        const allModels = models && models.length > 0 ? models : [defaultModel];
        const currentChapterModel = allModels[resolvedIndex % allModels.length];

        const newlyScannedNames = await scanNewNames({
          model: dictModel || currentChapterModel,
          sourceText: cleanedContent,
          novelId,
          existingDict: existingDictMap,
          signal,
        });

        if (newlyScannedNames.length > 0) {
          const addedCount = await autoAddNames(novelId, newlyScannedNames);
          console.log(`[3-Model Concurrent Pipeline] AI 2 hoàn thành: Đã tự động thêm ${addedCount} từ mới.`);
          for (const n of newlyScannedNames) {
            existingDictMap.set(n.chinese, n.vietnamese);
          }
        }

        try {
          const newlyScannedPronouns = await scanPronounRelations({
            model: dictModel || currentChapterModel,
            sourceText: cleanedContent,
            existingDict: existingDictMap,
            signal,
          });
          if (newlyScannedPronouns.length > 0) {
            const addedPronounCount = await autoUpdatePronounPrompt(novelId, newlyScannedPronouns);
            console.log(`[3-Model Concurrent Pipeline] AI 2 hoàn thành: Đã tự động thêm ${addedPronounCount} quy tắc xưng hô mới.`);
          }
        } catch (scanPronounErr) {
          console.warn(`[3-Model Concurrent Pipeline] Lỗi quét xưng hô:`, scanPronounErr);
        }
      } catch (scanErr) {
        console.warn(`[3-Model Concurrent Pipeline] Lỗi quét từ điển tại AI 2:`, scanErr);
      }

      store.setChapterStatus(novelId, chapId, "scanned");
      scannedChapterIds.add(chapId);
      scanIdx++;
    }
  };

  // Start background dictionary scanner worker
  runDictWorker();

  while (true) {
    if (signal?.aborted) break;

    // Pause loop
    while (useBulkTranslateStore.getState().jobs[novelId]?.isPaused) {
      await delay(1000);
      if (signal?.aborted) break;
    }
    if (signal?.aborted) break;

    // Fetch chapters dynamically
    const allChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
    let currentQueue: string[] = [];
    if (continuousMode) {
      const startIndex = allChapters.findIndex(c => chapterIdSet.has(c.id));
      const startIdx = startIndex >= 0 ? startIndex : 0;
      currentQueue = allChapters.slice(startIdx).map(c => c.id);
    } else {
      currentQueue = allChapters.filter(c => chapterIdSet.has(c.id)).map(c => c.id);
    }
    targetChapterIds = currentQueue;

    let chapterToProcess = null;
    let chapterScenes: Scene[] = [];
    let currentTranslateIdxVal = 0;

    for (let i = 0; i < currentQueue.length; i++) {
      const cid = currentQueue[i];
      if (processedIds.has(cid)) continue;

      const scenes = await db.scenes.where("chapterId").equals(cid).toArray();
      if (scenes.length === 0) continue;
      scenes.sort((a, b) => a.order - b.order);

      if (skipTranslated && scenes.some(isSceneTranslated)) {
        processedIds.add(cid);
        store.setChapterStatus(novelId, cid, "done");
        store.incrementCompleted(novelId);
        continue;
      }

      chapterToProcess = await db.chapters.get(cid);
      chapterScenes = scenes;
      currentTranslateIdxVal = i;
      break;
    }

    // Update store dynamic total in continuous mode
    if (continuousMode) {
      store.updateTotalChapters(novelId, allChapters.length);
    }

    if (!chapterToProcess) {
      if (continuousMode && pollingAttempts < 15) {
        pollingAttempts++;
        await delay(3000);
        continue;
      }
      break;
    }

    pollingAttempts = 0;
    currentTranslateIdx = currentTranslateIdxVal;

    // Wait until AI 2 completes scanning for this chapter
    const activeChapterId = chapterToProcess.id;
    while (!scannedChapterIds.has(activeChapterId)) {
      await delay(100);
      if (signal?.aborted) break;
    }
    if (signal?.aborted) break;

    // Double check pause after waiting
    while (useBulkTranslateStore.getState().jobs[novelId]?.isPaused) {
      await delay(500);
      if (signal?.aborted) break;
    }
    if (signal?.aborted) break;

    processedIds.add(activeChapterId);
    const chapter = chapterToProcess;

    // Select the model for this chapter based on index if multiple models are provided
    const chapterIndex = continuousMode
      ? allChapters.findIndex(c => c.id === chapter.id)
      : chapterIds.indexOf(chapter.id);
    const resolvedIndex = chapterIndex >= 0 ? chapterIndex : processedIds.size - 1;

    const allModels = models && models.length > 0 ? models : [defaultModel];
    const currentChapterModel = allModels[resolvedIndex % allModels.length];

    // Delay between chapters
    if (!isFirst && delayMs && delayMs > 0) {
      await delay(delayMs);
    }
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    store.setCurrentChapter(novelId, chapter.id);
    store.setChapterStatus(novelId, chapter.id, "translating");
    onChapterStart(chapter.id, chapter.title);

    try {
      const originalTitle = await resolveChapterOriginalTitle(chapter);
      const scenes = chapterScenes;
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

      // The chapter logic already skips translated chapters during discovery now.

      const SCENE_BREAK = "===SCENE_BREAK===";
      const isMultiScene = scenes.length > 1;
      const originalContents = await Promise.all(
        scenes.map((s) => getOriginalContent(s.id))
      );
      const joinedContent = isMultiScene
        ? originalContents.join(`\n\n${SCENE_BREAK}\n\n`)
        : originalContents[0];

      const cleanedContent = cleanGarbage ? cleanGarbageLines(joinedContent) : joinedContent;

      // Check if original content is already Vietnamese
      if (isVietnameseText(cleanedContent)) {
        onPhase(chapter.id, "done");

        const finalParsedScenes = scenes.map((s, i) => ({
          sceneId: s.id,
          content: originalContents[i],
        }));

        const now = new Date();
        for (const scene of finalParsedScenes) {
          const existing = await db.scenes.get(scene.sceneId);
          if (existing) {
            const origContent = await getOriginalContent(scene.sceneId);
            await ensureInitialVersion(scene.sceneId, existing.novelId, origContent);
            await createSceneVersion(scene.sceneId, existing.novelId, "hybrid-converter", scene.content);
          }
          await db.scenes.update(scene.sceneId, {
            content: scene.content,
            versionType: "hybrid-converter",
            wordCount: countWords(scene.content),
            updatedAt: now,
          });
        }

        onChapterComplete({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          originalTitle: originalTitle,
          newTitle: chapter.title,
          scenes: finalParsedScenes,
          extractedNamesCount: 0,
        });

        store.setChapterStatus(novelId, chapter.id, "done");
        store.addResult(novelId, {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          originalTitle: originalTitle,
          newTitle: chapter.title,
          originalLineCount: 0,
          translatedLineCount: 0,
          scenes: finalParsedScenes,
        });
        store.incrementCompleted(novelId);
        continue;
      }

      let finalParsedTitle: string | null = null;
      let finalParsedScenes: { sceneId: string; content: string }[] = [];
      let totalExtractedNamesCount = 0;

      let success = false;
      let finalError: unknown = null;

      for (let chapterAttempt = 1; chapterAttempt <= 3; chapterAttempt++) {
        if (signal?.aborted) break;
        try {
          if (chapterAttempt > 1) {
            onChapterError({
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              message: `Dịch lỗi. Thử lại dịch chương lần ${chapterAttempt}/3...`,
            });
            await delay(3000 * (chapterAttempt - 1));
          }


          // Fetch the latest dictionary (to include words extracted by Lookahead)
          nameDict = await getMergedNameDict(novelId);

          const chunks = chunkText(cleanedContent, 1600);
          let finalAccumulatedContent = "";
          let finalParsedTitle: string | null = null;
          let totalExtractedNamesCount = 0;
          let finalParsedScenes: { sceneId: string; content: string }[] = [];

          onPhase(chapter.id, "model1");

          for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
            const chunk = chunks[chunkIdx];

            if (signal?.aborted) {
              const err = new Error("Aborted");
              err.name = "AbortError";
              throw err;
            }

            // ═══════════════════════════════════════════
            // PHASE 1: Dictionary/STV Translation (fast)
            // ═══════════════════════════════════════════
            let dictTranslatedTitle: string = originalTitle;
            let dictTranslatedContent: string = "";

            try {
              // You must import stvTranslate locally or statically from STV translator
              const { stvTranslate } = await import("@/lib/api/stv-translator");
              const titlePromise = chunkIdx === 0
                ? stvTranslate(originalTitle, { signal, dictionary: nameDict })
                : Promise.resolve(originalTitle);

              const contentPromise = stvTranslate(chunk, { signal, dictionary: nameDict });

              const [titleRes, contentRes] = await Promise.all([titlePromise, contentPromise]);
              dictTranslatedTitle = titleRes;
              dictTranslatedContent = contentRes;
            } catch (err: any) {
              if (signal?.aborted || err?.name === "AbortError") throw err;
              throw new Error(`STV Chunk ${chunkIdx + 1}/${chunks.length} thất bại: ${err instanceof Error ? err.message : "Lỗi"}`);
            }

            // ═══════════════════════════════════════════
            // PHASE 2: AI Post-Edit (selective refine)
            // ═══════════════════════════════════════════
            onPhase(chapter.id, "model1");

            const systemPrompt = buildPostEditPrompt(
              chunk,
              dictTranslatedContent,
              nameDict,
              novelCustomPrompt,
              globalTranslatePrompt
            );

            const userPrompt = buildPostEditUserPrompt(
              chunk,
              dictTranslatedContent,
              chunkIdx === 0 ? originalTitle : undefined,
              chunkIdx === 0 ? dictTranslatedTitle : undefined,
              novelCustomPrompt,
            );

            let accumulated = "";
            let lastError: unknown = null;

            for (let attempt = 0; attempt <= MAX_PERSISTENT_ATTEMPTS; attempt++) {
              if (signal?.aborted) {
                const err = new Error("Aborted");
                err.name = "AbortError";
                throw err;
              }

              try {
                if (attempt > 0) {
                  onChapterError({
                    chapterId: chapter.id,
                    chapterTitle: chapter.title,
                    message: `Chunk ${chunkIdx + 1}: Thử lại lần ${attempt} sau 30s...`,
                  });
                }

                const result = await generateText({
                  model: currentChapterModel,
                  system: systemPrompt,
                  prompt: userPrompt,
                  abortSignal: signal,
                  maxOutputTokens: 10000,
                });

                accumulated = result.text ?? "";
                lastError = null;
                break;
              } catch (err: any) {
                if (signal?.aborted || err?.name === "AbortError") throw err;

                lastError = err;
                const classified = classifyError(err);

                if (attempt >= MAX_PERSISTENT_ATTEMPTS) {
                  throw new Error(`Chunk ${chunkIdx + 1} hết Token/lỗi AI: ${classified.message}`);
                }

                console.warn(`[Hybrid Retry] Chapter ${chapter.id} chunk ${chunkIdx} failed (attempt ${attempt}): ${classified.message}`);
                await delay(PERSISTENT_RETRY_DELAY);
              }
            }

            if (accumulated.trim()) {
              const parsed = parseHybridResult(accumulated, chunkIdx === 0);
              if (chunkIdx === 0) finalParsedTitle = parsed.title || dictTranslatedTitle;

              // Save extracted names dynamically
              if (opts.extractDict && parsed.extractedNames.length > 0) {
                try {
                  const entriesWithCategory = parsed.extractedNames.map((entry) => {
                    let category = "khác";
                    if (entry.dictType === "names") category = "nhân vật";
                    else if (entry.dictType === "tuvung") category = "thuật ngữ";
                    else if (entry.dictType === "ngucanh") category = "context mapping";
                    return { ...entry, category };
                  });

                  await bulkImportNameEntries(novelId, entriesWithCategory, "khác", "skip");
                  totalExtractedNamesCount += parsed.extractedNames.length;
                  nameDict = await getMergedNameDict(novelId);
                } catch (err) { }
              }

              // ═══════════════════════════════════════════
              // PHASE 2c: Model 3 QA Bot (Audit & Refine)
              // ═══════════════════════════════════════════
              let finalChunkContent = parsed.content || dictTranslatedContent;

              if (qaEnabled && qaModel) {
                onPhase(chapter.id, "model3");
                console.log(`[3-Model Pipeline] Đang chạy QA Bot tối ưu hóa đoạn ${chunkIdx + 1}/${chunks.length}...`);
                const latestNovel = await db.novels.get(novelId);
                const qaSystemPrompt = buildQaSystemPrompt(chunk, nameDict, opts.qaPrompt, latestNovel?.customPronounPrompt);
                const qaUserPrompt = buildQaUserPrompt(chunk, dictTranslatedContent, finalChunkContent);

                let qaResult = "";
                let qaError: unknown = null;
                for (let qaAttempt = 0; qaAttempt < 2; qaAttempt++) {
                  try {
                    const res = await generateText({
                      model: qaModel,
                      system: qaSystemPrompt,
                      prompt: qaUserPrompt,
                      abortSignal: signal,
                      maxOutputTokens: 10000,
                    });
                    qaResult = res.text ?? "";
                    if (qaResult.trim()) break;
                  } catch (err) {
                    qaError = err;
                    await delay(1000);
                  }
                }
                if (qaResult.trim()) {
                  finalChunkContent = parseQaAndApply(qaResult, finalChunkContent);
                } else {
                  console.warn(`[3-Model Pipeline] QA Bot chunk ${chunkIdx + 1} trả về kết quả rỗng hoặc lỗi:`, qaError);
                }
              }

              finalAccumulatedContent += (finalAccumulatedContent ? "\n\n" : "") + finalChunkContent;
            } else {
              throw new Error(`AI trả về nội dung trống ở đoạn ${chunkIdx + 1}`);
            }
          } // end chunks loop

          // Map back to scenes
          if (isMultiScene) {
            const parts = splitBySceneBreak(finalAccumulatedContent);
            if (parts.length === scenes.length) {
              finalParsedScenes = scenes.map((s, i) => ({
                sceneId: s.id,
                content: parts[i],
              }));
            } else {
              // Fallback to splitting by paragraph boundaries
              const splitParts = splitTextIntoParts(finalAccumulatedContent, scenes.length);
              finalParsedScenes = scenes.map((s, i) => ({
                sceneId: s.id,
                content: splitParts[i] || "",
              }));
            }
          } else {
            finalParsedScenes = [{ sceneId: scenes[0].id, content: finalAccumulatedContent }];
          }

          onPhase(chapter.id, "done");

          // Auto-save
          const now = new Date();
          if (finalParsedTitle) {
            await db.chapters.update(chapter.id, { title: finalParsedTitle, updatedAt: now });
          }
          for (const scene of finalParsedScenes) {
            const existing = await db.scenes.get(scene.sceneId);
            if (existing) {
              const origContent = await getOriginalContent(scene.sceneId);
              await ensureInitialVersion(scene.sceneId, existing.novelId, origContent);
              await createSceneVersion(scene.sceneId, existing.novelId, "hybrid-converter", scene.content);
            }
            await db.scenes.update(scene.sceneId, {
              content: scene.content,
              versionType: "hybrid-converter",
              wordCount: countWords(scene.content),
              updatedAt: now,
            });
          }

          onChapterComplete({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            originalTitle: originalTitle,
            newTitle: finalParsedTitle ?? chapter.title,
            scenes: finalParsedScenes,
            extractedNamesCount: totalExtractedNamesCount,
          });

          store.setChapterStatus(novelId, chapter.id, "done");
          store.addResult(novelId, {
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            originalTitle: originalTitle,
            newTitle: finalParsedTitle ?? chapter.title,
            originalLineCount: 0,
            translatedLineCount: 0,
            scenes: finalParsedScenes,
          });
          store.incrementCompleted(novelId);

          success = true;
          break;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") throw err;
          finalError = err;
          console.warn(`[Chapter Attempt ${chapterAttempt} Failed]`, err);
        }
      } // end retry loop

      if (!success) {
        throw finalError || new Error("Dịch chương thất bại sau 3 lần thử");
      }

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

      if (opts.errorAction === "skip") {
        // Bỏ qua chương lỗi, tiếp tục dịch chương tiếp theo
        continue;
      } else {
        // Stop the entire translation job immediately upon chapter failure
        store.cancel(novelId);
        break;
      }
    }
  }

  if (signal?.aborted) {
    store.cancel(novelId);
  } else {
    store.finish(novelId);
    onAllComplete();
  }
}
