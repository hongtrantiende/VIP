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
import { db, resolveChapterOriginalTitle } from "@/lib/db";
import type { AnalysisSettings, Scene, DictSource } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict, bulkImportNameEntries } from "@/lib/hooks/use-name-entries";
import { convertText } from "@/lib/hooks/use-qt-engine";
import { cleanGarbageLines, chunkText, splitBySceneBreak, splitTextIntoParts } from "@/lib/text-utils";
import { scanNewNames, autoAddNames, scanPronounRelations, autoUpdatePronounPrompt } from "./name-scanner";
import { buildQaSystemPrompt, buildQaUserPrompt, parseQaAndApply } from "./qa-helper";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { isSceneTranslated } from "@/lib/novel-io";
import { checkAndIncrementUsage } from "../usage-limits";
import { checkIsVipStandalone } from "../hooks/use-profile";
import { DEFAULT_EDIT_SYSTEM } from "./prompts";

export const STYLE_PRESETS = [
  { id: "default", name: "Mặc định (Standard)", rules: "" },
  { id: "tienhiep", name: "Tiên Hiệp / Võ Hiệp", rules: "Dịch theo văn phong Tiên Hiệp/Kiếm Hiệp cổ trang Trung Quốc. Hãy giữ đúng phong vị cổ kính, trang nghiêm. Ưu tiên các thuật ngữ Hán-Việt phổ biến trong giới tiên hiệp như: tu chân, đan điền, đan dược, linh khí, độ kiếp, ngự kiếm, đạo hữu, các cấp bậc tu luyện. Xưng hô chuẩn cổ trang (ví dụ: ta - ngươi, huynh - đệ, sư phụ - đồ nhi, tôn kính thì dùng vãn bối - tiền bối)." },
  { id: "huyenhuyen", name: "Huyền Huyễn / Kỳ Ảo", rules: "Dịch theo văn phong Huyền Huyễn kỳ ảo. Câu văn sinh động, hoành tráng, đầy sức tưởng tượng. Thích hợp cho bối cảnh dị thế ma pháp hoặc thế giới huyền ảo. Chú ý dịch chuẩn các thuật ngữ ma pháp, đấu khí, dị năng, chủng tộc dị giới và giữ xưng hô nhất quán dựa theo sức mạnh và vị thế." },
  { id: "dothi", name: "Đô Thị / Hiện Đại", rules: "Dịch theo văn phong Đô Thị hiện đại. Dùng từ ngữ đời thường, tự nhiên, gần gũi như đời sống hàng ngày ở Việt Nam. Tuyệt đối không lạm dụng các từ Hán-Việt quá cổ kính hay tối nghĩa (ví dụ: không dùng 'thủ cơ' mà dịch là 'điện thoại', không dùng 'kính xa' mà dịch là 'gương xe'). Xưng hô tự nhiên theo quan hệ hiện đại (tôi - bạn, anh - em, cậu - tớ)." },
  { id: "dammi_ngontinh", name: "Đam Mỹ / Ngôn Tình", rules: "Dịch theo văn phong tiểu thuyết lãng mạn (Đam mỹ/Ngôn tình). Chú ý câu văn mượt mà, uyển chuyển, giàu cảm xúc, nhấn mạnh tâm lý nhân vật. Chú ý dịch chuẩn xác các đại từ nhân xưng thể hiện sự thân mật, ngọt ngào hoặc đối đầu phức tạp (ví dụ: anh - em, hắn - cậu, ta - ngươi, nàng - ta, sư tôn - đệ tử) phù hợp với diễn biến tình cảm." }
];

// ── Constants ──

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

// ── Post-edit system prompt ──

export const HYBRID_POST_EDIT_BASE = `# Vai trò
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
6. **Không sót chữ Hán**: TUYỆT ĐỐI KHÔNG để sót bất kỳ chữ Hán (tiếng Trung) gốc nào trong phần <content>, kể cả trong ngoặc đơn. Toàn bộ phải được dịch hoặc phiên âm sang tiếng Việt.
7. **Nếu có bảng tên riêng**: BẮT BUỘC dùng đúng tên dịch đã cho, KHÔNG tự ý đổi.
8. KHÔNG giải thích thêm. Nếu không có từ nào cần trích xuất, để trống phần <names></names>.

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

export const PURE_TRANSLATE_PROMPT = `# Vai trò
Bạn là một dịch giả kiêm nhà biên kịch văn học Trung-Việt xuất sắc.
Nhiệm vụ: Hãy dịch trực tiếp văn bản TIẾNG TRUNG sau sang TIẾNG VIỆT tự nhiên, mượt mà và sinh động nhất.
Yêu cầu:
- BẮT BUỘC trả về kết quả bằng TIẾNG VIỆT hoàn chỉnh.
- Bảo đảm câu văn thuần Việt, trôi chảy, giữ nguyên ngữ cảnh và hồn tác phẩm.
- Tuân thủ tuyệt đối quy tắc dịch tên riêng từ danh sách được cung cấp.
- Giữ nguyên cấu trúc dòng, đoạn văn, dấu câu gốc.
- BẮT BUỘC dịch đầy đủ 100% nội dung, TUYỆT ĐỐI không tóm tắt, lược bỏ hay cắt bớt câu chữ. Giữ nguyên tất cả các dấu phân cảnh (như ===SCENE_BREAK===) ở vị trí gốc.
- TUYỆT ĐỐI KHÔNG để sót bất kỳ chữ Hán (tiếng Trung) gốc nào trong bản dịch, kể cả trong ngoặc đơn. Mọi nội dung phải được chuyển sang tiếng Việt.
- Không tự ý thêm bớt chi tiết cốt truyện.
- NGHIÊM CẤM chèn bất kỳ định dạng Markdown nào như in đậm **, ###. Chỉ xuất văn bản thuần túy.`;/**
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
  model?: LanguageModel;
  models?: LanguageModel[];
  qtDictSources: string[]; // the selected genre dictionaries
  dictModel?: LanguageModel; // Model 2 (Flash)
  qaModel?: LanguageModel;     // Model 3 (Audit)
  qaEnabled?: boolean;         // Check if QA Bot is enabled
  qaPrompt?: string;           // Custom Prompt for QA Bot
  promptType?: PromptType;
  extractDict?: boolean; // "Càng dịch càng hay" — extract names + upload to Supabase
  cleanGarbage?: boolean;
  skipTranslated?: boolean;
  chunkMode?: "chunk" | "full";
  continuousMode?: boolean; // Tự động nạp chương mới nếu có
  globalTranslatePrompt?: string;
  errorAction?: "stop" | "skip"; // "stop" = dừng lại khi lỗi, "skip" = bỏ qua chương lỗi
  signal?: AbortSignal;
  editorModel?: LanguageModel;
  twoPass?: boolean;
  stylePreset?: string;
  customStylePrompt?: string;
  customPronounPrompt?: string;
  delayMs?: number;
  hanVietRatio?: number; // 0-100 ratio


  onPhase: (chapterId: string, phase: string) => void;
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

const PERSISTENT_RETRY_DELAY = 5000; // 5s
const MAX_PERSISTENT_ATTEMPTS = 9999; // Thử lại vô hạn lần theo yêu cầu người dùng

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

// ── Build AI post-edit prompt with dictionary context ──

function buildPostEditPrompt(
  chineseText: string,
  dictTranslation: string,
  novelCustomPrompt?: string,
  promptType: PromptType = "legacy",
  extractDict: boolean = false,
  nameDict?: Array<{ chinese: string; vietnamese: string; category: string }>,
  globalTranslatePrompt?: string,
  customStylePrompt?: string,
): string {
  let prompt = "";

  if (promptType === "custom") {
    prompt = globalTranslatePrompt?.trim() || PURE_TRANSLATE_PROMPT;

    if (extractDict) {
      prompt += `\n\nĐịnh dạng đầu ra BẮT BUỘC:
<names>
[names]TênTrung1=TênViệt1
[names]TênTrung2=TênViệt2
[tuvung]ThuậtNgữTrung=ThuậtNgữViệt
</names>
<content>
(Nội dung dịch TIẾNG VIỆT hoàn thiện cuối cùng)
</content>`;
    }
  } else if (extractDict && (promptType === "khuyen_nghi" || promptType === "cuc_ngan")) {
    prompt = HYBRID_POST_EDIT_BASE;
  } else if (promptType === "khuyen_nghi" || promptType === "cuc_ngan") {
    prompt = "Bạn là dịch giả chuyên nghiệp Trung → Việt. BẮT BUỘC dịch đầy đủ 100% nội dung, TUYỆT ĐỐI không tóm tắt, cắt xén hay lược bỏ bất kỳ câu chữ nào. Trả lời bằng TIẾNG VIỆT. TUYỆT ĐỐI KHÔNG dịch sang tiếng Anh. NGHIÊM CẤM sử dụng định dạng Markdown (như **, ###). CHỈ trả về văn bản thuần túy. Giữ nguyên tất cả các dấu phân cảnh (như ===SCENE_BREAK===).";
  } else {
    prompt = HYBRID_POST_EDIT_BASE;
  }

  // Luôn luôn nối thêm custom prompt (chứa định nghĩa xưng hô, thể loại)
  if (novelCustomPrompt && novelCustomPrompt.trim()) {
    prompt += `\n\n# BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI PROMPT DỊCH / XƯNG HÔ / THỂ LOẠI SAU (ƯU TIÊN CAO NHẤT, TUYỆT ĐỐI KHÔNG TỰ Ý THÊM BỚT):\n${novelCustomPrompt.trim()}`;
  }

  // Add name dictionary context
  if (nameDict && nameDict.length > 0) {
    const relevantNames = nameDict.filter((n) =>
      chineseText.includes(n.chinese) &&
      ["nhân vật", "địa danh", "môn phái", "bang hội", "tên riêng", "thuật ngữ", "context mapping", "khác", "tuvung", "ngucanh"].includes(n.category)
    ).sort((a, b) => b.chinese.length - a.chinese.length);
    if (relevantNames.length > 0) {
      prompt += `\n\n# Bảng tên riêng (BẮT BUỘC dùng đúng)\n`;
      for (const n of relevantNames.slice(0, 150)) { // limit to 150 to avoid token bloat
        prompt += `${n.chinese} → ${n.vietnamese}\n`;
      }
    }
  }

  // Inject customStylePrompt (bao gồm NSFW prompt nếu được bật)
  if (customStylePrompt && customStylePrompt.trim()) {
    prompt += `\n\n# CHỈ DẪN VĂN PHONG DỊCH BỔ SUNG (BẮT BUỘC TUÂN THỦ):\n${customStylePrompt.trim()}`;
  }

  return prompt;
}

function buildPostEditUserPrompt(
  chineseText: string,
  dictTranslation: string,
  chineseTitle?: string,
  dictTitle?: string,
  promptType: PromptType = "legacy",
  extractDict: boolean = false,
  novelCustomPrompt?: string
): string {
  // Trọng số ưu tiên cao cho xưng hô/thể loại
  let customInstructions = "";
  if (novelCustomPrompt && novelCustomPrompt.trim()) {
    customInstructions = `\n\n⚠️ LƯU Ý BẮT BUỘC VỀ XƯNG HÔ/PHONG CÁCH:\n${novelCustomPrompt.trim()}\n\n`;
  }

  if (promptType === "custom") {
    let user = "";
    if (chineseTitle) {
      user += `Tiêu đề: ${chineseTitle}\n---\n`;
    }
    user += `[VĂN BẢN TIẾNG TRUNG BẢN GỐC]\n${chineseText}\n\n`;

    if (extractDict) {
      user += `Hãy dịch trực tiếp đoạn trên sang tiếng Việt và trả về theo định dạng thẻ <names> và <content>.
Trong đó:
- Phần <names>: Trích xuất các tên riêng mới xuất hiện nếu có.
- Phần <content>: Chứa nội dung dịch tiếng Việt hoàn chỉnh.
${chineseTitle ? `⚠️ LƯU Ý: Phần <content> PHẢI bắt đầu bằng Tiêu đề tiếng Việt mới, rồi đến dòng phân cách \n---\n rồi đến nội dung chương.` : ""}
⚠️ LƯU Ý 1: Vế trái trong thẻ names BẮT BUỘC phải là CHỮ HÁN BẢN GỐC.
⚠️ LƯU Ý 2: NGHIÊM CẤM dùng định dạng Markdown (**, ###) bên trong thẻ <content>.`;
    } else {
      user += `Hãy dịch trực tiếp đoạn trên sang tiếng Việt.`;
      if (chineseTitle) {
        user += `\n⚠️ BẮT BUỘC trả về đúng định dạng:\nTiêu đề tiếng Việt\n---\nNội dung chương dịch dịch tương ứng.`;
      }
      user += `\nChỉ trả về nội dung dịch tiếng Việt duy nhất, không giải thích gì thêm.`;
    }
    return user;
  }

  // When extractDict is on, force legacy user prompt format
  if (!extractDict) {
    if (promptType === "khuyen_nghi") {
      return `【Gốc】\n${chineseText.trim()}\n\n【Thô】\n${dictTranslation.trim()}\n\n【Refine】Sửa bản dịch thô cho mượt mà, xưng hô đúng, văn phong chuẩn thể loại. Dịch đầy đủ 100%, tuyệt đối không tóm tắt, cắt xén hay lược bỏ chữ. Giữ nguyên tất cả các dấu phân cảnh (như ===SCENE_BREAK===). Trả về bản dịch TIẾNG VIỆT cuối cùng thôi. KHÔNG dịch sang tiếng Anh. NGHIÊM CẤM chèn ký tự ** hay ###. ⚠️ TUYỆT ĐỐI TUÂN THỦ QUY TẮC XƯNG HÔ BÊN TRÊN!${customInstructions}`;
    }
    if (promptType === "cuc_ngan") {
      return `Sửa bản dịch Trung→Việt sau cho mượt, xưng hô đúng, sát gốc, đầy đủ 100% không tóm tắt hay cắt xén chữ. Giữ nguyên các dấu phân cảnh (như ===SCENE_BREAK===):\n\nGốc: ${chineseText.trim()}\n\nThô: ${dictTranslation.trim()}\n\nChỉ trả về bản dịch TIẾNG VIỆT đã sửa. KHÔNG dịch sang tiếng Anh. NGHIÊM CẤM dùng ký tự **. ⚠️ TUYỆT ĐỐI TUÂN THỦ QUY TẮC XƯNG HÔ!${customInstructions}`;
    }
  }

  let user = "";

  if (chineseTitle && dictTitle) {
    user += `Tiêu đề: ${chineseTitle} → ${dictTitle}\n---\n`;
  }

  user += `[GỐC]\n${chineseText}\n\n[DỊCH TỪ ĐIỂN]\n${dictTranslation}\n\nHãy phân tích và trả về <names> (nếu tìm thấy từ mới) và <content> (bản dịch TIẾNG VIỆT đã sửa lỗi) theo đúng format.
⚠️ LƯU Ý 1: Dù có trích xuất <names> hay không, vế trái BẮT BUỘC phải là CHỮ HÁN BẢN GỐC, KHÔNG ĐƯỢC để tiếng Việt ở vế trái!
⚠️ LƯU Ý 2: NGHIÊM CẤM dùng định dạng Markdown (**, ###) bên trong thẻ <content>.
⚠️ LƯU Ý 3: TUYỆT ĐỐI TUÂN THỦ CÁCH XƯNG HÔ ĐÃ QUY ĐỊNH BÊN TRÊN! Không được dịch bừa!
⚠️ LƯU Ý 4: BẮT BUỘC dịch đầy đủ 100%, tuyệt đối không tóm tắt, cắt xén hay lược bỏ câu chữ. Giữ nguyên định dạng và vị trí tất cả các dấu phân cảnh (như ===SCENE_BREAK===).${customInstructions}`;

  return user;
}

function parseHybridResult(
  raw: string,
  includeTitle: boolean,
  promptType: PromptType = "legacy",
  extractDict: boolean = false
): { title: string | null; content: string; extractedNames: Array<{ chinese: string, vietnamese: string, dictType: string }> } {
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
  let extractedNames: Array<{ chinese: string, vietnamese: string, dictType: string }> = [];

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

export async function runQtAiTranslate(opts: QtAiTranslateOptions): Promise<void> {
  const {
    novelId,
    chapterIds,
    model,
    models,
    promptType = "legacy",
    extractDict,
    cleanGarbage = true,
    qtDictSources,
    skipTranslated,
    continuousMode,
    globalTranslatePrompt,
    errorAction = "stop",
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

  const workerModels = models && models.length > 0 ? models : (model ? [model] : []);
  if (workerModels.length === 0) throw new Error("No model provided");

  // Fetch novel's custom translate prompt EARLY (needed for cold start scan too)
  const novel = await db.novels.get(novelId);
  let novelCustomPrompt = novel?.customTranslatePrompt || "";

  if (opts.hanVietRatio !== undefined) {
    const hv = opts.hanVietRatio;
    const tv = 100 - hv;
    novelCustomPrompt += `\n\n- Tỷ lệ từ vựng ưu tiên: ${hv}% Hán Việt, ${tv}% Thuần Việt (Quan trọng: Mức ${hv}% Hán Việt nghĩa là bạn phải tinh chỉnh mật độ từ Hán Việt trong bản dịch cho phù hợp).`;
  }

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

          let coldStartSystem = "Bạn là chuyên gia trích xuất thực thể tiếng Trung và phiên âm Hán-Việt. Luôn trả về đúng định dạng JSON Array chứa các đối tượng có thuộc tính chinese (chữ Hán gốc), vietnamese (phiên âm Hán-Việt chuẩn), và dictType (phân loại: 'names', 'tuvung', 'ngucanh'). KHÔNG trả về định dạng mảng chuỗi đơn giản. KHÔNG trích xuất đại từ nhân xưng hay từ thông dụng.";
          // Inject user's custom prompt into cold start scan
          if (novelCustomPrompt?.trim()) {
            coldStartSystem += `\n\n# QUY TẮC BỔ SUNG TỪ NGƯỜI DÙNG (ƯU TIÊN CAO NHẤT):\n${novelCustomPrompt.trim()}`;
          }
          const result = await streamText({
            model: workerModels[0],
            system: coldStartSystem,
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
          } catch (e) {
            console.warn("[Cold Start] Parse JSON thất bại:", rawText);
          }
        }
      }
    } catch (e) {
      console.error("[Cold Start] Lỗi quét từ điển tự động:", e);
    }
  }

  // novelCustomPrompt already loaded above (before cold start scan)

  let processedIds = new Set<string>();
  let currentTranslateIdx = 0;
  const scannedChapterIds = new Set<string>();
  let targetChapterIds: string[] = [];

  // Semaphore/Lock for thread-safe chapter pulling
  let isFetching = false;

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

      // Find scenes
      const scenes = await db.scenes.where("chapterId").equals(chapId).toArray();

      // Check skipTranslated
      if (skipTranslated && scenes.length > 0 && scenes.every(isSceneTranslated)) {
        scannedChapterIds.add(chapId);
        scanIdx++;
        continue;
      }

      if (!opts.extractDict) {
        scannedChapterIds.add(chapId);
        scanIdx++;
        continue;
      }

      // Perform Model 2 scan
      store.setChapterStatus(novelId, chapId, "scanning");
      try {
        console.log(`[3-Model Concurrent Pipeline QtAi] AI 2 Quét từ điển trước cho chương: ${chapter.title}`);
        const existingDictEntries = await getMergedNameDict(novelId);
        const existingDictMap = new Map(existingDictEntries.map(e => [e.chinese, e.vietnamese]));

        // Load original scene contents
        scenes.sort((a, b) => a.order - b.order);
        const originalContents = await Promise.all(scenes.map((s) => getOriginalContent(s.id)));
        const joinedContent = originalContents.join("\n\n===SCENE_BREAK===\n\n");
        const cleanedContent = cleanGarbage ? cleanGarbageLines(joinedContent) : joinedContent;

        const newlyScannedNames = await scanNewNames({
          model: opts.dictModel || workerModels[0],
          sourceText: cleanedContent,
          novelId,
          existingDict: existingDictMap,
          customScanPrompt: novelCustomPrompt,
          signal,
        });

        if (newlyScannedNames.length > 0) {
          const addedCount = await autoAddNames(novelId, newlyScannedNames);
          console.log(`[3-Model Concurrent Pipeline QtAi] AI 2 hoàn thành: Đã tự động thêm ${addedCount} từ mới.`);
          for (const n of newlyScannedNames) {
            existingDictMap.set(n.chinese, n.vietnamese);
          }
        }

        try {
          const newlyScannedPronouns = await scanPronounRelations({
            model: opts.dictModel || workerModels[0],
            sourceText: cleanedContent,
            existingDict: existingDictMap,
            customScanPrompt: novelCustomPrompt,
            signal,
          });
          if (newlyScannedPronouns.length > 0) {
            const addedPronounCount = await autoUpdatePronounPrompt(novelId, newlyScannedPronouns, existingDictMap);
            console.log(`[3-Model Concurrent Pipeline QtAi] AI 2 hoàn thành: Đã tự động thêm ${addedPronounCount} quy tắc xưng hô mới.`);
          }
        } catch (scanPronounErr) {
          console.warn(`[3-Model Concurrent Pipeline QtAi] Lỗi quét xưng hô:`, scanPronounErr);
        }
      } catch (scanErr) {
        console.warn(`[3-Model Concurrent Pipeline QtAi] Lỗi quét từ điển tại AI 2:`, scanErr);
      }

      store.setChapterStatus(novelId, chapId, "scanned");
      scannedChapterIds.add(chapId);
      scanIdx++;
    }
  };

  // Start background dictionary scanner worker
  runDictWorker();

  const runWorker = async (workerModel: LanguageModel, workerIndex: number) => {
    let isFirst = true;
    let pollingAttempts = 0;

    while (true) {
      if (signal?.aborted) break;

      // Pause loop
      while (useBulkTranslateStore.getState().jobs[novelId]?.isPaused) {
        await delay(1000);
        if (signal?.aborted) break;
      }
      if (signal?.aborted) break;

      // Wait for lock
      while (isFetching) { await delay(50); }
      isFetching = true;

      let chapterToProcess = null;
      let chapterScenes: Scene[] = [];
      let currentTranslateIdxVal = 0;

      try {
        // Fetch chapters dynamically
        const allChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");

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
            currentTranslateIdxVal = allChapters.indexOf(c);
            processedIds.add(c.id);
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
            currentTranslateIdxVal = allChapters.indexOf(c);
            processedIds.add(c.id);
            break;
          }
        }

        // Update store dynamic total in continuous mode
        if (continuousMode) {
          store.updateTotalChapters(novelId, allChapters.length);
        }
      } finally {
        isFetching = false;
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
      currentTranslateIdx = Math.max(currentTranslateIdx, currentTranslateIdxVal);
      const chapter = chapterToProcess;

      // Wait until AI 2 completes scanning for this chapter
      const activeChapterId = chapter.id;
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
        const isVip = await checkIsVipStandalone();
        if (!checkAndIncrementUsage("translate", 1, isVip)) {
          useBulkTranslateStore.getState().pause(novelId);
          onChapterError({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            message: "Hôm nay bạn đã dùng hết giới hạn 100 lượt dịch chương miễn phí. Hãy nâng cấp VIP để dùng không giới hạn!",
          });
          store.setChapterStatus(novelId, chapter.id, "error");
          store.incrementCompleted(novelId);
          break;
        }

        const scenes = chapterScenes;
        const originalTitle = await resolveChapterOriginalTitle(chapter);
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

            // Join scene contents — ALWAYS use ORIGINAL content (pre-translation)
            const SCENE_BREAK = "===SCENE_BREAK===";
            const isMultiScene = scenes.length > 1;
            const originalContents = await Promise.all(
              scenes.map((s) => getOriginalContent(s.id))
            );
            const joinedContent = isMultiScene
              ? originalContents.join(`\n\n${SCENE_BREAK}\n\n`)
              : originalContents[0];

            const cleanedContent = cleanGarbage ? cleanGarbageLines(joinedContent) : joinedContent;

            // Fetch the latest dictionary (to include words extracted by Lookahead)
            nameDict = await getMergedNameDict(novelId);

            const chunkSize = opts.chunkMode === "full" ? 20000 : 1600;
            const chunks = chunkText(cleanedContent, chunkSize);
            let finalAccumulatedContent = "";
            let finalParsedTitle: string | null = null;
            let totalExtractedNamesCount = 0;
            let finalParsedScenes: { sceneId: string; content: string }[] = [];



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
                const titlePromise = chunkIdx === 0
                  ? convertText(originalTitle, { novelNames: nameDict, options: { activeDictSources: qtDictSources } }).then(r => r.plainText)
                  : Promise.resolve(originalTitle);

                const contentPromise = convertText(chunk, { novelNames: nameDict, options: { activeDictSources: qtDictSources } }).then(r => r.plainText);

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

              const effectiveExtractDict = opts.extractDict ?? false;

              const systemPrompt = buildPostEditPrompt(
                chunk,
                dictTranslatedContent,
                novelCustomPrompt,
                opts.promptType,
                effectiveExtractDict,
                nameDict,
                globalTranslatePrompt,
                opts.customStylePrompt
              );

              const userPrompt = buildPostEditUserPrompt(
                chunk,
                dictTranslatedContent,
                chunkIdx === 0 ? originalTitle : undefined,
                chunkIdx === 0 ? dictTranslatedTitle : undefined,
                opts.promptType,
                effectiveExtractDict,
                novelCustomPrompt
              );

              let accumulated = "";
              let lastError: unknown = null;
              let activeSystemPrompt = systemPrompt;
              let hasTriedNsfwFallback = false;

              for (let attempt = 0; attempt <= MAX_PERSISTENT_ATTEMPTS * 2; attempt++) {
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

                  const result = await streamText({
                    model: workerModel,
                    system: activeSystemPrompt,
                    prompt: userPrompt,
                    abortSignal: signal,
                    maxOutputTokens: 10000,
                  });

                  let fullText = "";
                  for await (const chunkTxt of result.textStream) {
                    fullText += chunkTxt;
                  }

                  // Non-streaming fallback for proxy environments with buffering issues
                  if (!fullText.trim()) {
                    console.warn(`[AI] Stream returned empty. Retrying with generateText...`);
                    const { generateText } = await import("ai");
                    const directRes = await generateText({
                      model: workerModel,
                      system: activeSystemPrompt,
                      prompt: userPrompt,
                      abortSignal: signal,
                    });
                    fullText = directRes.text;
                  }

                  // Empty response retry (potential safety block)
                  if (!fullText.trim()) {
                    if (!hasTriedNsfwFallback) {
                      hasTriedNsfwFallback = true;
                      console.warn(`[Auto-NSFW] Direct returned empty. Retrying with NSFW R-18+ prompt...`);
                      const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                      activeSystemPrompt = `${activeSystemPrompt}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                      continue;
                    }
                    throw new Error("AI trả về nội dung trống nghi ngờ do bộ lọc an toàn");
                  }

                  accumulated = fullText;
                  lastError = null;
                  break;
                } catch (err: any) {
                  if (signal?.aborted || err?.name === "AbortError") throw err;

                  lastError = err;

                  const errMsg = err instanceof Error ? err.message : String(err);
                  const lowerErr = errMsg.toLowerCase();
                  const isSafetyBlock = lowerErr.includes('safety') || 
                                        lowerErr.includes('content filter') || 
                                        lowerErr.includes('blocked') || 
                                        lowerErr.includes('finish_reason') ||
                                        lowerErr.includes('finishreason') ||
                                        lowerErr.includes('candidate');

                  if (isSafetyBlock && !hasTriedNsfwFallback) {
                    hasTriedNsfwFallback = true;
                    console.warn(`[Auto-NSFW] Direct safety block triggered. Retrying with NSFW R-18+ prompt...`, err);
                    const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                    activeSystemPrompt = `${activeSystemPrompt}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                    continue;
                  }

                  const classified = classifyError(err);

                  if (attempt >= MAX_PERSISTENT_ATTEMPTS * 2) {
                    throw new Error(`Chunk ${chunkIdx + 1} hết Token/lỗi AI: ${classified.message}`);
                  }

                  console.warn(`[AI Retry] Chapter ${chapter.id} chunk ${chunkIdx} failed (attempt ${attempt}): ${classified.message}`);
                  await delay(PERSISTENT_RETRY_DELAY);
                }
              }

              if (accumulated.trim()) {
                const parsed = parseHybridResult(accumulated, chunkIdx === 0, opts.promptType, effectiveExtractDict);
                if (chunkIdx === 0) finalParsedTitle = parsed.title || dictTranslatedTitle;

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
                    totalExtractedNamesCount += parsed.extractedNames.length;
                    nameDict = await getMergedNameDict(novelId);
                  } catch (err) { }
                }

                let finalChunkContent = parsed.content || dictTranslatedContent;

                // ═══════════════════════════════════════════
                // PHASE 2b: Model 2 Refine (Two-Pass Editor)
                // ═══════════════════════════════════════════
                if (opts.twoPass && opts.editorModel) {
                  onPhase(chapter.id, "model2");
                  console.log(`[3-Model Pipeline QtAi] Đang chạy Editor (Pass 2) tối ưu hóa đoạn ${chunkIdx + 1}/${chunks.length}...`);
                  
                  const presetRules = STYLE_PRESETS.find(p => p.id === opts.stylePreset)?.rules || "";
                  const customRules = opts.customStylePrompt?.trim() || "";
                  let glossarySection = "";
                  
                  if (nameDict && nameDict.length > 0) {
                    const relevantNames = nameDict.filter((n) =>
                      chunk.includes(n.chinese) &&
                      ["nhân vật", "địa danh", "môn phái", "bang hội", "tên riêng", "thuật ngữ", "context mapping", "khác", "tuvung", "ngucanh"].includes(n.category)
                    ).sort((a, b) => b.chinese.length - a.chinese.length);
                    if (relevantNames.length > 0) {
                      glossarySection = `\n\n# THÔNG TIN TỪ ĐIỂN TÊN RIÊNG & THUẬT NGỮ (ƯU TIÊN CAO NHẤT):\n${relevantNames.slice(0, 150).map(e => `${e.chinese} → ${e.vietnamese}`).join("\n")}`;
                    }
                  }

                  const editSystemPrompt = `${DEFAULT_EDIT_SYSTEM}
                  
# THÔNG TIN BỐI CẢNH & QUY TẮC BỔ SUNG:
- Thể loại/Văn phong yêu cầu: ${opts.stylePreset || "Mặc định (Standard)"}
- Chỉ thị văn phong đặc biệt: ${customRules || "Không có"}
${opts.customPronounPrompt ? `- Quy tắc xưng hô: ${opts.customPronounPrompt}` : ""}
${glossarySection}`;

                  const editUserPrompt = `NGUYÊN TÁC TRUNG QUỐC:\n${chunk}\n\nBẢN DỊCH THÔ CẦN BIÊN TẬP:\n${finalChunkContent}`;

                  let pass2ResultText = "";
                  let editError: unknown = null;
                  let activeEditSystemPrompt = editSystemPrompt;
                  let hasTriedNsfwEditFallback = false;

                  for (let editAttempt = 0; editAttempt < 6; editAttempt++) {
                    if (signal?.aborted) break;
                    try {
                      const res = await streamText({
                        model: opts.editorModel,
                        system: activeEditSystemPrompt,
                        prompt: editUserPrompt,
                        abortSignal: signal,
                      });
                      let fullText = "";
                      for await (const chunkTxt of res.textStream) {
                        fullText += chunkTxt;
                      }
                      if (!fullText.trim()) {
                        const { generateText } = await import("ai");
                        const directRes = await generateText({
                          model: opts.editorModel,
                          system: activeEditSystemPrompt,
                          prompt: editUserPrompt,
                          abortSignal: signal,
                        });
                        fullText = directRes.text;
                      }

                      // Empty response retry (potential safety block)
                      if (!fullText.trim()) {
                        if (!hasTriedNsfwEditFallback) {
                          hasTriedNsfwEditFallback = true;
                          console.warn(`[Auto-NSFW] Editor returned empty. Retrying with NSFW R-18+ prompt...`);
                          const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                          activeEditSystemPrompt = `${activeEditSystemPrompt}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                          continue;
                        }
                        throw new Error("AI biên tập trả về nội dung trống nghi ngờ do bộ lọc an toàn");
                      }

                      pass2ResultText = fullText;
                      if (pass2ResultText.trim()) break;
                    } catch (err: any) {
                      editError = err;
                      
                      const errMsg = err instanceof Error ? err.message : String(err);
                      const lowerErr = errMsg.toLowerCase();
                      const isSafetyBlock = lowerErr.includes('safety') || 
                                            lowerErr.includes('content filter') || 
                                            lowerErr.includes('blocked') || 
                                            lowerErr.includes('finish_reason') ||
                                            lowerErr.includes('finishreason') ||
                                            lowerErr.includes('candidate');

                      if (isSafetyBlock && !hasTriedNsfwEditFallback) {
                        hasTriedNsfwEditFallback = true;
                        console.warn(`[Auto-NSFW] Editor safety block triggered. Retrying with NSFW R-18+ prompt...`, err);
                        const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                        activeEditSystemPrompt = `${activeEditSystemPrompt}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                        continue;
                      }

                      await delay(1000);
                    }
                  }
                  if (pass2ResultText.trim()) {
                    let cleanPass2 = pass2ResultText.trim();
                    const contentMatch = cleanPass2.match(/<content>([\s\S]*?)<\/content>/i);
                    if (contentMatch) {
                      cleanPass2 = contentMatch[1].trim();
                    } else {
                      cleanPass2 = cleanPass2.replace(/<content>|<\/content>/gi, "").trim();
                    }
                    cleanPass2 = cleanPass2.replace(/\*\*/g, "").replace(/^###\s+/gm, "").trim();
                    finalChunkContent = cleanPass2;
                  } else {
                    console.warn(`[3-Model Pipeline QtAi] Editor (Pass 2) chunk rỗng hoặc lỗi:`, editError);
                  }
                }

                // ═══════════════════════════════════════════
                // PHASE 2c: Model 3 QA Bot (Audit & Refine)
                // ═══════════════════════════════════════════
                if (opts.qaEnabled && opts.qaModel) {
                  onPhase(chapter.id, "model3");
                  console.log(`[3-Model Pipeline QtAi] Đang chạy QA Bot tối ưu hóa đoạn ${chunkIdx + 1}/${chunks.length}...`);
                  const latestNovel = await db.novels.get(novelId);
                  const qaSystemPrompt = buildQaSystemPrompt(chunk, nameDict, opts.qaPrompt, latestNovel?.customPronounPrompt);
                  const qaUserPrompt = buildQaUserPrompt(chunk, dictTranslatedContent, finalChunkContent);

                  let qaResult = "";
                  let qaError: unknown = null;
                  for (let qaAttempt = 0; qaAttempt < 2; qaAttempt++) {
                    try {
                      const { generateText } = await import("ai");
                      const res = await generateText({
                        model: opts.qaModel,
                        system: qaSystemPrompt,
                        prompt: qaUserPrompt,
                        abortSignal: signal,
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
                    console.warn(`[3-Model Pipeline QtAi] QA Bot chunk rỗng hoặc lỗi:`, qaError);
                  }
                }

                finalAccumulatedContent += (finalAccumulatedContent ? "\n\n" : "") + finalChunkContent;
              } else {
                throw new Error(`AI trả về nội dung trống ở đoạn ${chunkIdx + 1}`);
              }
            } // end of chunks loop

            // Map final string back to scenes
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

        if (errorAction === "skip") {
          // Bỏ qua chương lỗi, tiếp tục dịch chương tiếp theo
          continue;
        } else {
          // Stop the entire translation job immediately upon chapter failure
          store.cancel(novelId);
          break;
        }
      }
    } // End of while loop
  }; // End of runWorker

  // Run all workers concurrently
  await Promise.allSettled(workerModels.map((m, i) => runWorker(m, i)));

  if (signal?.aborted) {
    store.cancel(novelId);
  } else {
    store.finish(novelId);
    onAllComplete();
  }
}
