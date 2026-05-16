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
import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db } from "@/lib/db";
import type { AnalysisSettings, Scene, DictSource } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict, bulkImportNameEntries } from "@/lib/hooks/use-name-entries";
import { appendToDictSource, normalizeGenre } from "@/lib/hooks/use-dict-entries";
import { convertText } from "@/lib/hooks/use-qt-engine";
import { cleanGarbageLines } from "@/lib/text-utils";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { isSceneTranslated } from "@/lib/novel-io";

// ── Constants ──

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

// ── Post-edit system prompt ──

const HYBRID_POST_EDIT_BASE = `# Vai trò
Bạn là biên tập viên văn học chuyên nghiệp chuyên dịch tiểu thuyết Trung Quốc sang TIẾNG VIỆT. 
⚠️ BẮT BUỘC: Toàn bộ đầu ra PHẢI bằng TIẾNG VIỆT. TUYỆT ĐỐI KHÔNG dịch sang tiếng Anh.
Bạn KHÔNG dịch lại từ đầu, bạn chỉ SỬA LỖI bản dịch từ điển Trung → Việt sẵn có.

# Nhiệm vụ  
Nhận bản dịch từ điển Trung → Việt và văn bản gốc tiếng Trung. Chỉ sửa những chỗ SAI, giữ nguyên phần đã đúng. Kết quả cuối cùng PHẢI là TIẾNG VIỆT.
NGHIÊM CẤM sử dụng bất kỳ định dạng Markdown nào (như in đậm **, tiêu đề ###, hoặc bảng biểu). Chỉ xuất văn bản thuần túy.

# Quy tắc sửa BẮT BUỘC
1. **Tên nhân vật/địa danh/vũ khí**: Sửa tên bị dịch sai/dịch nghĩa. Phải phiên âm Hán-Việt CHUẨN. Viết hoa chữ cái đầu mỗi từ (ví dụ: Tô Dật, Thanh Đường, Cửu Ngục Kiếm).
2. **Xưng hô**: PHẢI đi theo thể loại và phong cách truyện. Truyện tiên hiệp dùng ta/ngươi, tại hạ, bản tọa, sư huynh/sư đệ. Truyện đô thị dùng tôi/anh/cậu.
3. **Ngữ cảnh**: Sửa câu bị dịch sai nghĩa do thiếu ngữ cảnh (đại từ nhầm, quan hệ nhầm).
4. **Văn phong**: Sửa câu cứng/lủng củng cho tự nhiên hơn nhưng giữ đúng phong cách thể loại. KHÔNG thuần Việt hóa quá mức — giữ hơi thở nguyên tác.
5. **Giữ nguyên**: Giữ nguyên cấu trúc đoạn văn, dấu ngắt dòng, định dạng gốc. KHÔNG thêm bớt nội dung.
6. **Nếu có bảng tên riêng**: BẮT BUỘC dùng đúng tên dịch đã cho, KHÔNG tự ý đổi.

# Yêu cầu đầu ra (BẮT BUỘC THEO ĐÚNG FORMAT NÀY):
<names>
[names]TênTrung1=TênViệt1
[names]TênTrung2=TênViệt2
[tuvung]ThuậtNgữTrung=ThuậtNgữViệt
[ngucanh]CụmTừTrung=CụmTừViệt
</names>
<content>
(Văn bản dịch TIẾNG VIỆT đã sửa lỗi — KHÔNG PHẢI tiếng Anh. TUYỆT ĐỐI KHÔNG chứa ký tự ** hay ###)
</content>

Lưu ý PHÂN LOẠI (TRÍCH XUẤT TỪ ĐIỂN):
- [names]: Tên nhân vật, địa danh, tông môn, bang hội (phiên âm Hán-Việt, viết hoa)
- [tuvung]: Kỹ năng, vũ khí, vật phẩm, thuật ngữ tu luyện (ví dụ: cảnh giới, công pháp)
- [ngucanh]: Thành ngữ, cụm từ ngữ cảnh, câu nói đặc trưng

⚠️ QUY TẮC TRÍCH XUẤT TỪ ĐIỂN (TỐI QUAN TRỌNG):
1. Định dạng: \`[loại]TiếngTrung=TiếngViệt\` (1 mục 1 dòng)
2. Vế trái (trước dấu =) BẮT BUỘC phải là CHỮ HÁN BẢN GỐC (chữ tiếng Trung lấy từ phần [GỐC]).
3. Vế phải (sau dấu =) là nghĩa tiếng Việt tương ứng.
4. TUYỆT ĐỐI KHÔNG trích xuất kiểu tiếng Việt = tiếng Việt (Ví dụ: Nội công=nội công -> SAI NGHIÊM TRỌNG). Phải là: 內功=nội công.
KHÔNG giải thích thêm. Nếu không có từ nào cần trích xuất, để trống phần <names></names>.`;


/**
 * Build genre-aware post-edit prompt.
 * If novel has a scanned custom prompt (from scanNovelStyle), use it as context.
 */
function buildGenreAwareSystemPrompt(
  novelCustomPrompt?: string,
): string {
  let prompt = HYBRID_POST_EDIT_BASE;

  if (novelCustomPrompt?.trim()) {
    prompt += `\n\n# Ngữ cảnh thể loại truyện (từ quét phong cách)\n${novelCustomPrompt.trim()}`;
  }

  return prompt;
}

// ── Types ──

export type PromptType = "legacy" | "khuyen_nghi" | "cuc_ngan" | "custom";

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

export interface QtAiTranslateOptions {
  novelId: string;
  chapterIds: string[];
  model: LanguageModel;
  qtDictSources: string[]; // the selected genre dictionaries
  promptType?: PromptType;
  extractDict?: boolean; // "Càng dịch càng hay" — extract names + upload to Supabase
  skipTranslated?: boolean;
  continuousMode?: boolean; // Tự động nạp chương mới nếu có
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

const extractionCache = new Set<string>();

async function triggerBackgroundLookahead(novelId: string, chapterId: string, model: LanguageModel, signal?: AbortSignal) {
  if (extractionCache.has(chapterId)) return;
  extractionCache.add(chapterId);

  try {
    console.log(`[Lookahead] Kích hoạt quét ngầm tên cho chương tiếp theo...`);
    const scenes = await db.scenes.where("chapterId").equals(chapterId).toArray();
    if (scenes.length === 0) return;
    scenes.sort((a,b)=>a.order-b.order);
    
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
        system: "Bạn là chuyên gia trích xuất thực thể tiếng Trung. Luôn trả về mảng chuỗi dạng JSON. Trích xuất toàn bộ tên riêng, môn phái, địa danh, công pháp xuất hiện trong đoạn văn. KHÔNG trích xuất đại từ nhân xưng, từ thông dụng.",
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
  } catch(e) {
    if (e instanceof Error && e.name === "AbortError") return;
    console.warn(`[Lookahead] Lỗi quét ngầm:`, e);
  }
}

/**
 * Upload a genre dict source to Supabase storage after appending new names.
 */


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

const PERSISTENT_RETRY_DELAY = 30000; // 30s
const MAX_PERSISTENT_ATTEMPTS = 9999; // Thử lại vô hạn lần theo yêu cầu người dùng

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

/**
 * Replaces Chinese names with their Vietnamese equivalents in the raw Chinese text.
 * Sorts names by length descending to avoid partial word replacements.
 */
function injectNamesIntoChinese(
  text: string,
  nameDict: Array<{ chinese: string; vietnamese: string }>
): string {
  if (!nameDict || nameDict.length === 0) return text;

  // Filter out names that are not in the text first for performance
  const relevantNames = nameDict.filter((n) => text.includes(n.chinese));
  if (relevantNames.length === 0) return text;

  // Sort descending by length to replace longer names first (e.g. replace "林动哥" before "林动")
  relevantNames.sort((a, b) => b.chinese.length - a.chinese.length);

  let injectedText = text;
  for (const n of relevantNames) {
    // Escape regex characters just in case, though Chinese names rarely have them
    const safeChinese = n.chinese.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(safeChinese, 'g');
    injectedText = injectedText.replace(regex, n.vietnamese);
  }

  return injectedText;
}

// ── Build AI post-edit prompt with dictionary context ──

function buildPostEditPrompt(
  chineseText: string,
  dictTranslation: string,
  novelCustomPrompt?: string,
  promptType: PromptType = "legacy",
  extractDict: boolean = false
): string {
  // When extractDict is on, force legacy extraction mode
  if (extractDict && (promptType === "khuyen_nghi" || promptType === "cuc_ngan")) {
    // Fall through to legacy prompt with full <names>/<content> extraction
  } else if (promptType === "khuyen_nghi" || promptType === "cuc_ngan") {
    return "Bạn là dịch giả chuyên nghiệp Trung → Việt. BẮT BUỘC trả lời bằng TIẾNG VIỆT. TUYỆT ĐỐI KHÔNG dịch sang tiếng Anh. NGHIÊM CẤM sử dụng định dạng Markdown (như **, ###). CHỈ trả về văn bản thuần túy.";
  }


  let prompt = buildGenreAwareSystemPrompt(novelCustomPrompt);

  // Name dictionary context is no longer appended here because names are now directly pre-injected into the Chinese text (Name Pre-translation)
  return prompt;
}

function buildPostEditUserPrompt(
  chineseText: string,
  dictTranslation: string,
  chineseTitle?: string,
  dictTitle?: string,
  promptType: PromptType = "legacy",
  extractDict: boolean = false
): string {
  // When extractDict is on, force legacy user prompt format
  if (!extractDict) {
    if (promptType === "khuyen_nghi") {
      return `【Gốc】\n${chineseText.trim()}\n\n【Thô】\n${dictTranslation.trim()}\n\n【Refine】Sửa bản dịch thô cho mượt mà, xưng hô đúng, văn phong chuẩn thể loại. Trả về bản dịch TIẾNG VIỆT cuối cùng thôi. KHÔNG dịch sang tiếng Anh. NGHIÊM CẤM chèn ký tự ** hay ### vào kết quả.`;
    }
    if (promptType === "cuc_ngan") {
      return `Sửa bản dịch Trung→Việt sau cho mượt, xưng hô đúng, sát gốc:\n\nGốc: ${chineseText.trim()}\n\nThô: ${dictTranslation.trim()}\n\nChỉ trả về bản dịch TIẾNG VIỆT đã sửa. KHÔNG dịch sang tiếng Anh. NGHIÊM CẤM dùng ký tự **.`;
    }
  }
  if (promptType === "custom" && !extractDict) {
    return `【Gốc】\n${chineseText.trim()}\n\n【Thô】\n${dictTranslation.trim()}\n\n【Refine】Sửa cho mượt mà, xưng hô chuẩn, văn phong đúng thể loại. Chỉ trả về bản dịch TIẾNG VIỆT cuối. KHÔNG dịch sang tiếng Anh. NGHIÊM CẤM sử dụng **.`;
  }

  let user = "";
  
  if (chineseTitle && dictTitle) {
    user += `Tiêu đề: ${chineseTitle} → ${dictTitle}\n---\n`;
  }
  
  user += `[GỐC]\n${chineseText}\n\n[DỊCH TỪ ĐIỂN]\n${dictTranslation}\n\nHãy phân tích và trả về <names> (nếu tìm thấy từ mới) và <content> (bản dịch TIẾNG VIỆT đã sửa lỗi) theo đúng format.
⚠️ LƯU Ý: Nếu có trích xuất <names>, vế trái BẮT BUỘC phải là CHỮ HÁN BẢN GỐC (Tiếng Trung), KHÔNG ĐƯỢC để tiếng Việt ở vế trái!
⚠️ NGHIÊM CẤM sử dụng định dạng Markdown (**, ###) bên trong thẻ <content>.`;
  
  return user;
}

function parseHybridResult(
  raw: string,
  includeTitle: boolean,
  promptType: PromptType = "legacy",
  extractDict: boolean = false
): { title: string | null; content: string; extractedNames: Array<{chinese: string, vietnamese: string, dictType: string}> } {
  // If extractDict is on, always parse with extraction regardless of promptType
  if (promptType !== "legacy" && !extractDict) {
    let contentPart = raw.trim();
    // Loại bỏ các markdown block nếu AI tự động chèn vào
    contentPart = contentPart.replace(/^```[\s\S]*?\n/g, "").replace(/```$/g, "").trim();
    // Loại bỏ ký tự in đậm ** và ###
    contentPart = contentPart.replace(/\*\*/g, "").replace(/^###\s+/gm, "").trim();
    return { title: null, content: contentPart, extractedNames: [] };
  }

  let contentPart = raw;
  let extractedNames: Array<{chinese: string, vietnamese: string, dictType: string}> = [];

  const namesMatch = raw.match(/<names>([\s\S]*?)<\/names>/i);
  if (namesMatch) {
    const lines = namesMatch[1].trim().split("\n");
    for (let line of lines) {
      if (line.includes("=")) {
        line = line.trim();
        // Check for classification tag [names], [tuvung], [ngucanh]
        const tagMatch = line.match(/^\[(\w+)\]/);
        const dictType = tagMatch ? tagMatch[1] : "names"; // default to "names" if no tag
        const cleanedLine = tagMatch ? line.slice(tagMatch[0].length) : line;
        const [cn, vn] = cleanedLine.split("=").map(s => s.trim());
        if (cn && vn && cn !== vn) {
          // Validate that the left side actually contains Chinese characters
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

  // Remove bold markdown and headers just in case
  contentPart = contentPart.replace(/\*\*/g, "").replace(/^###\s+/gm, "").trim();

  if (!includeTitle) return { title: null, content: contentPart, extractedNames };

  const sepIndex = contentPart.indexOf("\n---\n");
  if (sepIndex === -1) return { title: null, content: contentPart, extractedNames };

  const title = contentPart.slice(0, sepIndex).trim();
  
  // Bảo vệ: Nếu title chứa xuống dòng (nhiều dòng) hoặc quá dài, đó không phải là title thật
  if (title.includes("\n") || title.length > 200) {
    return { title: null, content: contentPart, extractedNames };
  }

  const textBody = contentPart.slice(sepIndex + 5).trim();
  return { title: title || null, content: textBody, extractedNames };
}

// ── Main hybrid engine ──

export async function runQtAiTranslate(opts: QtAiTranslateOptions): Promise<void> {
  const {
    novelId,
    chapterIds,
    model,
    qtDictSources,
    skipTranslated,
    continuousMode,
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

  // ── Auto Initial Dictionary Scan (Khởi động từ điển) ──
  if (nameDict.length === 0) {
    try {
      console.log("[Cold Start] Từ điển trống, tiến hành quét 1 chương đầu...");
      const allChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
      const firstChapter = allChapters.slice(0, 1);
      if (firstChapter.length > 0) {
        let combinedText = "";
        for (const c of firstChapter) {
          const chapSc = await db.scenes.where("chapterId").equals(c.id).toArray();
          chapSc.sort((a,b)=>a.order-b.order);
          const contents = await Promise.all(chapSc.map(s => getOriginalContent(s.id)));
          combinedText += contents.join("\n\n") + "\n\n";
        }
        
        // Quét toàn bộ nội dung chương để đảm bảo không lọt từ vựng
        const cleaned = cleanGarbageLines(combinedText); 

        if (cleaned.trim()) {
          const prompt = `Trích xuất toàn bộ tên riêng (nhân vật chính/phụ, địa danh, môn phái) từ văn bản tiếng Trung sau. 
BẮT BUỘC trả về đúng định dạng JSON Array: [{"chinese": "tên tiếng Trung", "vietnamese": "Hán Việt", "dictType": "names"}]. 
CẤM DỊCH NỘI DUNG. CHỈ TRẢ VỀ JSON, KHÔNG GIẢI THÍCH GÌ THÊM.

[VĂN BẢN]
${cleaned}`;
          
          const result = await streamText({
            model,
            system: "Bạn là chuyên gia trích xuất thực thể tiếng Trung. Luôn trả về mảng chuỗi dạng JSON (ví dụ: [\"Tên 1\", \"Tên 2\"]). Trích xuất toàn bộ tên riêng, môn phái, địa danh, công pháp xuất hiện trong đoạn văn. KHÔNG trích xuất đại từ nhân xưng, từ thông dụng.",
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
            // Find JSON array in the text
            const match = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (match) {
              const arr = JSON.parse(match[0]);
              if (Array.isArray(arr) && arr.length > 0) {
                const entriesWithCategory = arr.map((entry: any) => ({
                  chinese: entry.chinese || "",
                  vietnamese: entry.vietnamese || "",
                  category: entry.dictType === "names" ? "nhân vật" : "khác",
                  dictType: entry.dictType || "names"
                })).filter(e => e.chinese && e.vietnamese && /[\u4e00-\u9fa5]/.test(e.chinese));
                
                if (entriesWithCategory.length > 0) {
                  await bulkImportNameEntries(novelId, entriesWithCategory, "khác", "skip");
                  nameDict = await getMergedNameDict(novelId);
                  console.log(`[Cold Start] Đã trích xuất ${entriesWithCategory.length} tên vào từ điển.`);
                }
              }
            }
          } catch(e) {
            console.warn("[Cold Start] Parse JSON thất bại:", rawText);
          }
        }
      }
    } catch(e) {
      console.error("[Cold Start] Lỗi quét từ điển tự động:", e);
    }
  }

  // Fetch novel's custom translate prompt (from genre scan)
  const novel = await db.novels.get(novelId);
  const novelCustomPrompt = novel?.customTranslatePrompt;

  let isFirst = true;
  let processedIds = new Set<string>();
  let pollingAttempts = 0;

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
    
    let chapterToProcess = null;
    let chapterScenes: Scene[] = [];

    if (continuousMode) {
      for (const c of allChapters) {
        if (processedIds.has(c.id)) continue;
        const scenes = await db.scenes.where("chapterId").equals(c.id).toArray();
        if (scenes.length === 0) continue;
        scenes.sort((a, b) => a.order - b.order);

        if (skipTranslated && scenes.some(isSceneTranslated)) {
          processedIds.add(c.id);
          store.setChapterStatus(novelId, c.id, "done");
          store.incrementCompleted(novelId);
          continue;
        }

        chapterToProcess = c;
        chapterScenes = scenes;
        break;
      }
    } else {
      // Legacy mode: process from chapterIdSet
      for (const c of allChapters) {
        if (!chapterIdSet.has(c.id) || processedIds.has(c.id)) continue;
        const scenes = await db.scenes.where("chapterId").equals(c.id).toArray();
        scenes.sort((a, b) => a.order - b.order);

        if (skipTranslated && scenes.some(isSceneTranslated)) {
          processedIds.add(c.id);
          store.setChapterStatus(novelId, c.id, "done");
          store.incrementCompleted(novelId);
          continue;
        }

        chapterToProcess = c;
        chapterScenes = scenes;
        break;
      }
    }

    // Update store dynamic total in continuous mode
    if (continuousMode) {
      store.updateTotalChapters(novelId, allChapters.length);
    }

    if (!chapterToProcess) {
      if (continuousMode && pollingAttempts < 15) {
        // Wait for scraper to catch up (up to 45 seconds)
        pollingAttempts++;
        await delay(3000);
        continue;
      }
      break; // No more chapters
    }

    pollingAttempts = 0;
    processedIds.add(chapterToProcess.id);
    const chapter = chapterToProcess;

    // Lookahead cho chương tiếp theo
    if (opts.extractDict) {
      let nextChapterToProcess = null;
      if (continuousMode) {
         const currentIndex = allChapters.findIndex(c => c.id === chapter.id);
         if (currentIndex !== -1 && currentIndex + 1 < allChapters.length) {
           nextChapterToProcess = allChapters[currentIndex + 1];
         }
      } else {
         for (const c of allChapters) {
           if (chapterIdSet.has(c.id) && !processedIds.has(c.id) && c.id !== chapter.id) {
             nextChapterToProcess = c;
             break;
           }
         }
      }
      if (nextChapterToProcess) {
         // Fire and forget
         triggerBackgroundLookahead(novelId, nextChapterToProcess.id, model, signal);
      }
    }

    // Delay between chapters
    if (!isFirst && delayMs && delayMs > 0) {
      await delay(delayMs);
    }
    isFirst = false;
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    store.setCurrentChapter(novelId, chapter.id);
    store.setChapterStatus(novelId, chapter.id, "translating");
    onChapterStart(chapter.id, chapter.title);

    try {
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

      // Fetch the latest dictionary (to include words extracted by Lookahead)
      nameDict = await getMergedNameDict(novelId);

      // ═══════════════════════════════════════════
      // PHASE 1: Dictionary/STV Translation (fast)
      // ═══════════════════════════════════════════
      onPhase(chapter.id, "dict");

      let dictTranslatedTitle: string;
      let dictTranslatedContent: string;

      try {
        const dictSettings = {
          options: {
            activeDictSources: qtDictSources
          }
        };
        const [titleRes, contentRes] = await Promise.all([
          convertText(chapter.title, { novelNames: nameDict, options: { activeDictSources: qtDictSources } }),
          convertText(cleanedContent, { novelNames: nameDict, options: { activeDictSources: qtDictSources } }),
        ]);
        dictTranslatedTitle = titleRes.plainText;
        dictTranslatedContent = contentRes.plainText;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        // If STV fails, skip to error
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: `STV dịch thất bại: ${err instanceof Error ? err.message : "Lỗi"}`,
        });
        store.setChapterStatus(novelId, chapter.id, "error");
        store.addError(novelId, {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: `STV dịch thất bại: ${err instanceof Error ? err.message : "Lỗi"}`,
        });
        store.incrementCompleted(novelId);
        continue;
      }

      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      // ═══════════════════════════════════════════
      // PHASE 2: AI Post-Edit (selective refine)
      // ═══════════════════════════════════════════
      onPhase(chapter.id, "ai");

      const effectiveExtractDict = opts.extractDict ?? false;

      // ── Name Pre-translation (Name Injection) ──
      // Thay vì ném bảng tên vào system prompt gây tốn token,
      // ta nhét thẳng tên tiếng Việt vào bản raw tiếng Trung.
      // Khi AI nhìn thấy bản raw đã có sẵn tên tiếng Việt, nó sẽ tự động giữ nguyên.
      const injectedChineseContent = injectNamesIntoChinese(cleanedContent, nameDict);
      const injectedChineseTitle = injectNamesIntoChinese(chapter.title, nameDict);

      const systemPrompt = buildPostEditPrompt(
        injectedChineseContent,
        dictTranslatedContent,
        novelCustomPrompt,
        opts.promptType,
        effectiveExtractDict
      );

      const userPrompt = buildPostEditUserPrompt(
        injectedChineseContent,
        dictTranslatedContent,
        injectedChineseTitle,
        dictTranslatedTitle,
        opts.promptType,
        effectiveExtractDict
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
              message: `Thử lại lần ${attempt} sau 30s...`,
            });
          }

          const result = await streamText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            abortSignal: signal,
          });

          let fullText = "";
          for await (const chunk of result.textStream) {
            fullText += chunk;
          }
          accumulated = fullText;
          lastError = null;
          break;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") throw err;

          lastError = err;
          const classified = classifyError(err);

          if (attempt >= MAX_PERSISTENT_ATTEMPTS) {
            throw new Error(`Hết Token hoặc lỗi AI kéo dài (Thử lại 10 lần thất bại): ${classified.message}`);
          }

          console.warn(`[AI Retry] Chapter ${chapter.id} failed (attempt ${attempt}): ${classified.message}`);
          await delay(PERSISTENT_RETRY_DELAY);
        }
      }

      // Use AI result if available, otherwise dictionary result
      let parsedTitle: string | null = null;
      let parsedScenes: { sceneId: string; content: string }[] = [];
      let extractedNamesCount = 0;

      if (accumulated.trim()) {
        const parsed = parseHybridResult(accumulated, true, opts.promptType, effectiveExtractDict);
        parsedTitle = parsed.title || dictTranslatedTitle;
        
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
            
            const importResult = await bulkImportNameEntries(
              novelId,
              entriesWithCategory,
              "khác",
              "skip"
            );
            extractedNamesCount = parsed.extractedNames.length;
            // Update nameDict for subsequent chapters in the loop
            nameDict = await getMergedNameDict(novelId);

            // If extractDict is on, classify and append to correct genre sub-dicts, then upload
            if (effectiveExtractDict && importResult.added > 0) {
              try {
                const novel = await db.novels.get(novelId);
                // Ưu tiên lấy thể loại từ truyện, nếu không có mới lấy từ từ điển đang dùng
                const rawGenre = novel?.genre || (novel?.genres && novel.genres[0]) || opts.qtDictSources?.[0] || "tienhiep";
                const genreKey = normalizeGenre(rawGenre);

                // Group extracted names by dictType (names, tuvung, ngucanh)
                const grouped: Record<string, Array<{chinese: string, vietnamese: string}>> = {};
                for (const entry of parsed.extractedNames) {
                  const dt = entry.dictType || "names";
                  // Only allow known dict types
                  if (dt !== "names" && dt !== "tuvung" && dt !== "ngucanh") continue;
                  if (!grouped[dt]) grouped[dt] = [];
                  grouped[dt].push({ chinese: entry.chinese, vietnamese: entry.vietnamese });
                }
                for (const [dictType, entries] of Object.entries(grouped)) {
                  const dictSource = `${genreKey}_${dictType}` as DictSource;
                  await appendToDictSource(dictSource, entries);
                }
                
                // Upload to community dictionary table (Google Drive) - chạy ngầm không chờ

              } catch (uploadErr) {
                console.warn("[ExtractDict] Genre dict upload skipped:", uploadErr);
              }
            }
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
        // This branch should ideally not be reached if we throw on AI failure,
        // but just in case, we'll keep it safe by not doing anything here or throwing.
        throw new Error("AI trả về nội dung trống");
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
