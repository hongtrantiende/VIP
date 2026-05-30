/**
 * Gen 3 Translation Engine: Inline Semantic Markup (Đánh dấu ngữ nghĩa nội tuyến)
 * 
 * Triết lý:
 *   - Không bắt AI nhớ từ điển rời rạc (chèn inline XML <name vi="...">, <item vi="...">).
 *   - Không phá hủy văn bản gốc (giữ nguyên chữ Hán gốc bên trong thẻ XML).
 *   - Xưng hô động chuẩn xác bằng cách dùng Model 2 (Flash) phân tích bối cảnh thoại
 *     và bao bọc thẻ <dialogue speaker="..." listener="..." rule="...">.
 *   - Dịch định hướng tối cao bằng Model 1 (Pro) tuân thủ XML.
 */
import { generateText, streamText } from "ai";
import type { LanguageModel } from "ai";
import { db, GENRE_LABELS, resolveChapterOriginalTitle } from "@/lib/db";
import type { NameEntry, Scene } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict, bulkImportNameEntries } from "@/lib/hooks/use-name-entries";
import { cleanGarbageLines, chunkText, isVietnameseText, splitBySceneBreak, splitTextIntoParts } from "@/lib/text-utils";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { isSceneTranslated } from "@/lib/novel-io";
import { checkAndIncrementUsage } from "../usage-limits";
import { checkIsVipStandalone } from "../hooks/use-profile";
import { scanNewNames, autoAddNames, scanPronounRelations, autoUpdatePronounPrompt } from "./name-scanner";

// ── Constants ──
const MAX_PERSISTENT_ATTEMPTS = 3;
const PERSISTENT_RETRY_DELAY = 5000;
const SCENE_BREAK = "\n\n[=== SCENE BREAK ===]\n\n";

export interface SemanticTranslateResult {
  chapterId: string;
  chapterTitle: string;
  originalTitle: string;
  newTitle: string | undefined;
  scenes: { sceneId: string; content: string }[];
  extractedNamesCount: number;
}

export interface SemanticTranslateError {
  chapterId: string;
  chapterTitle: string;
  message: string;
}

export interface SemanticTranslateOptions {
  novelId: string;
  chapterIds: string[];
  model: LanguageModel;        // Model 1 (Dịch chính, Pro)
  dictModel?: LanguageModel;   // Model 2 (Phân tích bối cảnh / Gắn thẻ, Flash)
  qaModel?: LanguageModel;     // Model 3 (Audit/QA Bot - nếu có)
  qaEnabled?: boolean;
  qaPrompt?: string;
  extractDict?: boolean;
  cleanGarbage?: boolean;
  skipTranslated?: boolean;
  chunkMode?: "chunk" | "full";
  continuousMode?: boolean;
  customTranslatePrompt?: string;
  customStylePrompt?: string;
  customPronounPrompt?: string;
  errorAction?: "stop" | "skip";
  signal?: AbortSignal;
  delayMs?: number;

  onPhase: (chapterId: string, phase: "dict" | "ai" | "done" | "model1" | "model2" | "model3") => void;
  onChapterStart: (chapterId: string, chapterTitle: string) => void;
  onChapterComplete: (result: SemanticTranslateResult) => void;
  onChapterError: (error: SemanticTranslateError) => void;
  onAllComplete: () => void;
}

// ── Helpers ──
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length;
}

/**
 * Clean residual XML tags left by AI translation
 */
export function cleanResidualXmlTags(text: string): string {
  if (!text) return "";
  return text
    .replace(/<\/?(?:name|item|dialogue|entity)(?:\s+[^>]+)*>/gi, "")
    .trim();
}

/**
 * Smart Parsing - Deterministic Tagger (Backend Code)
 * Greedy matches the dictionary entries on the Chinese source text and wraps them in XML tags.
 */
export function applyDeterministicXmlTagging(sourceText: string, nameDict: Array<{ chinese: string; vietnamese: string; category: string }>): string {
  if (!sourceText || nameDict.length === 0) return sourceText;

  // Filter dictionary entries that are present in the text and exclude pronoun rules ("xưng hô")
  const validEntries = nameDict
    .filter(
      (e) =>
        e.chinese &&
        e.vietnamese &&
        e.category !== "xưng hô" &&
        sourceText.includes(e.chinese)
    )
    // Sort by Chinese characters length descending to ensure longer phrases are matched first
    .sort((a, b) => b.chinese.length - a.chinese.length);

  if (validEntries.length === 0) return sourceText;

  // Greedy match intervals to prevent overlapping tags
  const taggedIntervals: Array<{ start: number; end: number }> = [];

  const checkOverlap = (start: number, end: number) => {
    for (const interval of taggedIntervals) {
      if (start < interval.end && end > interval.start) {
        return true;
      }
    }
    return false;
  };

  const matches: Array<{ start: number; end: number; entry: { chinese: string; vietnamese: string; category: string } }> = [];

  for (const entry of validEntries) {
    let index = sourceText.indexOf(entry.chinese);
    while (index !== -1) {
      const start = index;
      const end = index + entry.chinese.length;

      if (!checkOverlap(start, end)) {
        matches.push({ start, end, entry });
        taggedIntervals.push({ start, end });
      }

      index = sourceText.indexOf(entry.chinese, index + 1);
    }
  }

  // Sort matches by start position ascending
  matches.sort((a, b) => a.start - b.start);

  let result = "";
  let lastIdx = 0;

  for (const match of matches) {
    result += sourceText.slice(lastIdx, match.start);
    const { chinese, vietnamese, category } = match.entry;

    const isName = ["nhân vật", "names", "địa danh", "môn phái", "bang hội", "tên riêng"].includes(category);
    const isItem = ["tuvung", "thuật ngữ", "vật phẩm", "kỹ năng", "thuật ngữ tu tiên"].includes(category);

    if (isName) {
      result += `<name vi="${vietnamese}">${chinese}</name>`;
    } else if (isItem) {
      result += `<item vi="${vietnamese}">${chinese}</item>`;
    } else {
      result += `<entity type="${category}" vi="${vietnamese}">${chinese}</entity>`;
    }

    lastIdx = match.end;
  }

  result += sourceText.slice(lastIdx);
  return result;
}

/**
 * Dialogue Tagging via Model 2 (Flash)
 * Wraps dialogues with <dialogue speaker="..." listener="..." rule="..."> tags.
 */
export async function applyDialogueSemanticTagging(opts: {
  model: LanguageModel;
  text: string;
  pronounRules: Array<{ chinese: string; vietnamese: string; category: string }>;
  signal?: AbortSignal;
}): Promise<string> {
  const { model, text, pronounRules, signal } = opts;

  if (!text.trim()) return text;

  // Build pronoun rules description
  let pronounRulesPrompt = "";
  for (const p of pronounRules) {
    const cnKey = p.chinese; // Formatted as "林枫->楚瑶"
    const [speakerCn, listenerCn] = cnKey.split("->").map((s) => s.trim());
    const parts = p.vietnamese.split("|");
    const pronPart = parts[0];
    const namePart = parts[1] || "";
    const [speakerPron, listenerPron] = pronPart.split("->").map((s) => s.trim());
    const [speakerName, listenerName] = namePart.split("->").map((s) => s.trim());

    if (speakerName && listenerName && speakerPron && listenerPron) {
      pronounRulesPrompt += `- ${speakerName} nói với ${listenerName}: ${speakerName} xưng "${speakerPron}", gọi ${listenerName} là "${listenerPron}"\n`;
    }
  }

  const system = `Bạn là chuyên gia phân tích ngữ cảnh và đại từ xưng hô trong tiểu thuyết.
Nhiệm vụ của bạn: Đọc văn bản tiếng Trung (đã được Backend gắn các thẻ tên riêng <name vi="...">) và xác định xem ai đang nói chuyện với ai trong mỗi câu thoại nằm trong ngoặc kép “...” hoặc "..." hoặc ‘...’.
Sau đó, bao bọc TOÀN BỘ câu thoại đó bằng thẻ:
<dialogue speaker="Tên người nói" listener="Tên người nghe" rule="Quy tắc xưng hô giữa hai người">“Câu thoại gốc”</dialogue>

Quy tắc BẮT BUỘC:
1. Trường 'speaker' và 'listener' BẮT BUỘC phải là TÊN TIẾNG VIỆT của nhân vật (lấy từ thuộc tính 'vi' của thẻ <name vi="..."> tương ứng ở bối cảnh xung quanh câu thoại đó). Tuyệt đối KHÔNG dùng tên tiếng Trung hay Pinyin.
2. Trường 'rule' là Quy tắc xưng hô bắt buộc giữa hai nhân vật này (ví dụ: "Bạch Vân Phi xưng 'Bổn tọa', gọi Lâm Động là 'tiểu tử'" hoặc "Lâm Động xưng 'đệ', gọi Sở Dao là 'sư tỷ'"), đối chiếu chính xác từ [DANH SÁCH QUY TẮC XƯNG HÔ] được cung cấp bên dưới.
3. Đối với các phần mô tả, dẫn truyện, hoặc suy nghĩ nội tâm (không phải thoại trực tiếp phát ra miệng), giữ nguyên văn bản gốc, TUYỆT ĐỐI KHÔNG chèn thẻ <dialogue>.
4. Giữ nguyên 100% tất cả các thẻ <name vi="...">, <item vi="..."> cũ của văn bản gốc, KHÔNG được tự ý xóa bỏ hay dịch nghĩa.
5. Chỉ trả về văn bản gốc tiếng Trung đã được bao bọc thêm các thẻ <dialogue> tương ứng. Tuyệt đối KHÔNG dịch văn bản, KHÔNG thêm bớt từ ngữ, và KHÔNG viết thêm bất kỳ lời bình luận hay giải thích nào.`;

  const prompt = `[DANH SÁCH QUY TẮC XƯNG HÔ CÓ SẴN]:
${pronounRulesPrompt || "Chưa có quy tắc cụ thể, hãy tự xác định xưng hô hợp lý theo quan hệ nhân vật phát hiện được."}

[VĂN BẢN TIẾNG TRUNG ĐÃ GẮN THẺ TÊN RIÊNG]:
${text}

Hãy xử lý và chỉ trả về văn bản tiếng Trung đã chèn thẻ <dialogue> hoàn chỉnh:`;

  const attemptController = new AbortController();
  const onAbortMain = () => attemptController.abort();
  if (signal) {
    signal.addEventListener("abort", onAbortMain);
  }

  const timeoutId = setTimeout(() => {
    console.warn(`[Dialogue Tagger] Quét thẻ hội thoại vượt quá 30 giây. Chủ động bỏ qua để tiến hành dịch chính...`);
    attemptController.abort();
  }, 30000);

  try {
    const result = await generateText({
      model,
      system,
      prompt,
      abortSignal: attemptController.signal,
    });

    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onAbortMain);
    }

    const output = result.text.trim();
    if (output) {
      // Basic sanity check to ensure output is not entirely blank or unrelated
      if (output.includes("<name") || output.includes("<dialogue") || output.length > text.length * 0.7) {
        return output;
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onAbortMain);
    }
    console.warn("[Dialogue Tagger] Model 2 failed to tag dialogues, falling back to original tagged text:", err);
  }

  return text;
}

// ── Prompts builder for Phase 3 ──
function getSemanticSystemPrompt(
  genreText: string,
  genreGuidelines: string,
  customTranslatePrompt?: string,
  customStylePrompt?: string,
) {
  let customInstructions = "";
  if (customTranslatePrompt?.trim()) {
    customInstructions += `\n\n# CHỈ DẪN PROMPT DỊCH (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI):\n${customTranslatePrompt.trim()}`;
  }
  if (customStylePrompt?.trim()) {
    customInstructions += `\n\n# CHỈ DẪN VỀ VĂN PHONG DỊCH (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI):\n${customStylePrompt.trim()}`;
  }

  return `# Vai trò
Bạn là một dịch giả tiểu thuyết Trung-Việt chuyên nghiệp và là chuyên gia chuyển ngữ giàu kinh nghiệm.
Nhiệm vụ của bạn là chuyển ngữ văn bản tiếng Trung đã được "Đánh dấu ngữ nghĩa nội tuyến" bằng thẻ XML dưới đây sang bản dịch TIẾNG VIỆT trơn tru, giàu văn phong văn học nhất.

# Thể loại truyện của tác phẩm này: ${genreText}
${genreGuidelines}

# LUẬT BẮT BUỘC (QUAN TRỌNG NHẤT - KHÔNG ĐƯỢC VI PHẠM):
1. **Ép buộc chính xác từ điển 100%**: 
   - Bất cứ khi nào bạn gặp các thẻ dạng \`<name vi="Nghĩa dịch">Chữ Trung</name>\` hoặc \`<item vi="Nghĩa dịch">Chữ Trung</item>\` hoặc \`<entity type="..." vi="Nghĩa dịch">Chữ Trung</entity>\`, bạn BẮT BUỘC phải sử dụng chính xác cụm từ nằm trong thuộc tính 'vi' cho bản dịch tiếng Việt của mình.
   - Tuyệt đối NGHIÊM CẤM tự ý dịch nghĩa khác, đổi chữ hoặc bỏ bớt/thay đổi nhầm dấu tiếng Việt của các thực thể đã được chỉ định (Ví dụ: gặp \`<name vi="Lâm Động">林动</name>\` thì bản dịch phải ghi đúng là "Lâm Động").
2. **Tuân thủ quy tắc xưng hô trong thoại**:
   - Khi gặp thẻ \`<dialogue speaker="..." listener="..." rule="...">“...”</dialogue>\`, bạn PHẢI dịch phần hội thoại tiếng Trung bên trong thẻ đó áp dụng chính xác quy tắc xưng hô mô tả trong thuộc tính 'rule' (Ví dụ: rule='Bạch Vân Phi xưng Bổn tọa, gọi Lâm Động là tiểu tử' -> trong hội thoại đó Bạch Vân Phi phải tự xưng là Bổn tọa, gọi Lâm Động là tiểu tử).
   - Hãy điều chỉnh ngữ khí dịch mượt mà, tự nhiên và trôi chảy nhất phù hợp với quy tắc xưng hô này.
3. **Bóc tách và loại bỏ thẻ XML tự động**:
   - Bản dịch đầu ra cuối cùng của bạn PHẢI là văn bản tiếng Việt trơn tru hoàn chỉnh, KHÔNG được chứa các thẻ XML \`<name>\`, \`<item>\`, \`<dialogue>\` hay \`<entity>\` nữa (bạn hãy dịch nội dung bên trong thẻ và trả về kết quả tiếng Việt sạch sẽ).
4. **Bản dịch đầy đủ 100% (Tuyệt đối không tóm tắt)**: Dịch đầy đủ trọn vẹn 100% nội dung chương truyện. Nghiêm cấm lược dịch, tóm tắt ý hoặc cắt giảm bất kỳ câu chữ nào.
5. **Giữ nguyên dấu phân cảnh**: Nếu có các dấu phân cách phân cảnh (như ===SCENE_BREAK===), bạn BẮT BUỘC phải giữ nguyên chính xác 100% vị trí và định dạng của các dấu này, không thay đổi, không dịch nghĩa, không tự viết lại.

# Yêu cầu đầu ra:
<content>
(Văn bản dịch TIẾNG VIỆT hoàn chỉnh, mượt mà và sạch sẽ - TUYỆT ĐỐI KHÔNG chứa các thẻ XML cũ và không chứa markdown ** hay ###)
</content>
` + customInstructions;
}

// ── Main Translation Orchestrator ──
export async function runSemanticTranslate(opts: SemanticTranslateOptions) {
  const {
    novelId,
    chapterIds,
    model, // Model 1
    dictModel, // Model 2
    qaModel,
    qaEnabled = false,
    qaPrompt,
    extractDict = false,
    cleanGarbage = true,
    skipTranslated = true,
    chunkMode,
    continuousMode = false,
    customTranslatePrompt,
    customStylePrompt,
    customPronounPrompt,
    errorAction = "stop",
    signal,
    delayMs = 0,
    onPhase,
    onChapterStart,
    onChapterComplete,
    onChapterError,
    onAllComplete,
  } = opts;

  const store = useBulkTranslateStore.getState();
  const novel = await db.novels.get(novelId);
  const novelCustomPrompt = novel?.customTranslatePrompt?.trim() || "";
  const novelScanPrompt = novel?.customModel2Prompt?.trim() || novelCustomPrompt;
  const genreKeys = novel?.genres || (novel?.genre ? [novel.genre] : []);
  const genreText = genreKeys.map(k => GENRE_LABELS[k] || k).join(", ") || "Chưa xác định";

  // Build guidelines based on novel genre
  let genreGuidelines = "";
  if (genreKeys.some(k => ["tienhiep", "huyenhuyen", "dongphuong", "quybi"].includes(k))) {
    genreGuidelines = `
    - **Đặc trưng Thể loại (Tiên hiệp / Khoa huyễn / Huyền huyễn)**: Tông giọng cổ kính, tôn nghiêm, sử dụng từ ngữ Hán Việt văn học cổ phong hợp lý.
    - **Quy tắc xưng hô**: Ưu tiên cổ phong trang nghiêm (Ta - Ngươi, Huynh - Đệ, Sư tôn - Đồ đệ, Bổn tọa, Các hạ, Tiền bối - Vãn bối). Tránh dùng xưng hô hiện đại trừ phi bối cảnh đặc biệt.`;
  } else if (genreKeys.some(k => ["dothi", "hiendai", "school", "hocduong", "vongdu"].includes(k))) {
    genreGuidelines = `
    - **Đặc trưng Thể loại (Hiện hiện / Đô thị / Võng du)**: Hành văn hiện đại, trẻ trung, đời thường, trôi chảy tự nhiên.
    - **Quy tắc xưng hô**: Linh hoạt theo bối cảnh xã hội hiện đại (Tôi - Cậu, Anh - Em, Ta - Ngươi khi thù địch, Hắn, Nàng, Gã). Tránh hành văn cổ phong quá đà.`;
  } else if (genreKeys.some(k => ["ngontinh", "dammi"].includes(k))) {
    genreGuidelines = `
    - **Đặc trưng Thể loại (Ngôn tình / Đam mỹ)**: Văn phong giàu cảm xúc, lãng mạn, mượt mà quyến rũ, tập trung sâu mô tả nội tâm và đường nét cử chỉ.
    - **Quy tắc xưng hô**: Phải sâu lắng và tình cảm (Ta - Chàng / Thiếp nếu cổ đại; Anh - Em, Tôi - Em nếu hiện đại, hoặc các thể loại tự xưng thân mật). Ngăn chặn tình trạng xưng hô lạnh lùng, cứng nhắc.`;
  } else {
    genreGuidelines = `
    - **Đặc trưng Thể loại**: Xưng hô linh hoạt, tôn trọng văn cảnh và nhịp điệu của thể loại nguyên bản.`;
  }

  const chapterIdSet = new Set(chapterIds);

  store.initJob(novelId);
  store.start(novelId, chapterIds, undefined, undefined);

  let processedIds = new Set<string>();
  let pollingAttempts = 0;
  let currentTranslateIdx = 0;
  let targetChapterIds: string[] = [];

  // Primary worker (AI 1) for translation
  const runWorker = async () => {
    while (true) {
      if (signal?.aborted) break;

      while (store.jobs[novelId]?.isPaused) {
        await delay(1000);
        if (signal?.aborted) break;
      }
      if (signal?.aborted) break;

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

        const cScenes = await db.scenes.where("chapterId").equals(cid).toArray();
        cScenes.sort((a, b) => a.order - b.order);
        if (cScenes.length === 0) continue;

        if (skipTranslated && cScenes.every(isSceneTranslated)) {
          processedIds.add(cid);
          store.setChapterStatus(novelId, cid, "done");
          store.incrementCompleted(novelId);
          continue;
        }

        chapterToProcess = await db.chapters.get(cid);
        chapterScenes = cScenes;
        currentTranslateIdxVal = i;
        break;
      }

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

      const activeChapterId = chapterToProcess.id;

      while (store.jobs[novelId]?.isPaused) {
        await delay(500);
        if (signal?.aborted) break;
      }
      if (signal?.aborted) break;

      processedIds.add(activeChapterId);
      const chapter = chapterToProcess;
      const originalTitle = await resolveChapterOriginalTitle(chapter);

      onChapterStart(chapter.id, chapter.title);

      // Inline sequential dictionary scanner
      if (extractDict && !chapter.dictionaryScanned) {
        onPhase(chapter.id, "model2");
        store.setChapterStatus(novelId, chapter.id, "scanning");
        try {
          console.log(`[Semantic Gen 3] AI 2 Quét từ điển inline cho chương: ${chapter.title}`);
          const existingDictEntries = await getMergedNameDict(novelId);
          const existingDictMap = new Map(existingDictEntries.map(e => [e.chinese, e.vietnamese]));

          const originalContents = await Promise.all(chapterScenes.map((s) => getOriginalContent(s.id)));
          const cleanedContent = cleanGarbage ? cleanGarbageLines(originalContents.join(SCENE_BREAK)) : originalContents.join(SCENE_BREAK);

          const newlyScannedNames = await scanNewNames({
            model: dictModel || model,
            sourceText: cleanedContent,
            novelId,
            existingDict: existingDictMap,
            customScanPrompt: novelScanPrompt,
            signal,
          });

          if (newlyScannedNames.length > 0) {
            const addedCount = await autoAddNames(novelId, newlyScannedNames);
            console.log(`[Semantic Gen 3] AI 2 đã thêm ${addedCount} từ mới vào từ điển.`);
          }

          try {
            const newlyScannedPronouns = await scanPronounRelations({
              model: dictModel || model,
              sourceText: cleanedContent,
              existingDict: existingDictMap,
              customScanPrompt: novelScanPrompt,
              signal,
              novelId,
            });
            if (newlyScannedPronouns.length > 0) {
              await autoUpdatePronounPrompt(novelId, newlyScannedPronouns, existingDictMap);
              console.log(`[Semantic Gen 3] AI 2 đã cập nhật quy tắc xưng hô mới.`);
            }
          } catch (scanPronounErr) {
            console.warn(`[Semantic Gen 3] Lỗi quét xưng hô:`, scanPronounErr);
          }
        } catch (scanErr) {
          console.warn(`[Semantic Gen 3] Lỗi quét từ điển inline:`, scanErr);
        }
        await db.chapters.update(chapter.id, { dictionaryScanned: true });
      }

      store.setChapterStatus(novelId, chapter.id, "translating");

      try {
        const isMultiScene = chapterScenes.length > 1;
        const rawTexts = await Promise.all(chapterScenes.map((s) => getOriginalContent(s.id)));
        const cleanedContent = rawTexts.join(SCENE_BREAK);

        // If already in Vietnamese, skip translating
        if (isVietnameseText(cleanedContent)) {
          onPhase(chapter.id, "done");

          const finalParsedScenes = chapterScenes.map((s, i) => ({
            sceneId: s.id,
            content: rawTexts[i],
          }));

          const now = new Date();
          for (const scene of finalParsedScenes) {
            const existing = await db.scenes.get(scene.sceneId);
            if (existing) {
              const origContent = await getOriginalContent(scene.sceneId);
              await ensureInitialVersion(scene.sceneId, existing.novelId, origContent);
              await createSceneVersion(scene.sceneId, existing.novelId, "ai-translate", scene.content);
            }
            await db.scenes.update(scene.sceneId, {
              content: scene.content,
              versionType: "ai-translate",
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

        const isVip = await checkIsVipStandalone();
        if (!checkAndIncrementUsage("translate", 1, isVip)) {
          store.pause(novelId);
          onChapterError({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            message: "Hôm nay bạn đã dùng hết giới hạn 100 lượt dịch chương miễn phí. Hãy nâng cấp VIP để dùng không giới hạn!",
          });
          store.setChapterStatus(novelId, chapter.id, "error");
          store.incrementCompleted(novelId);
          break;
        }

        if (delayMs > 0) {
          await delay(delayMs);
        }

        onPhase(chapter.id, "dict");

        // Load dictionary and pronoun rules
        const nameDict = await getMergedNameDict(novelId);
        const pronounRules = nameDict.filter((n) => n.category === "xưng hô");

        // ═══════════════════════════════════════════
        // PHASE 1: Smart Parsing (Deterministic Tagging)
        // ═══════════════════════════════════════════
        const taggedChineseContent = applyDeterministicXmlTagging(cleanedContent, nameDict);

        // ═══════════════════════════════════════════
        // PHASE 2: Dynamic Dialogue & Pronoun Tagging via Model 2 (Flash)
        // ═══════════════════════════════════════════
        onPhase(chapter.id, "model2");
        const fullyTaggedChineseContent = await applyDialogueSemanticTagging({
          model: dictModel || model,
          text: taggedChineseContent,
          pronounRules,
          signal,
        });

        // ═══════════════════════════════════════════
        // PHASE 3: Semantic-Guided Translation via Model 1 (Pro)
        // ═══════════════════════════════════════════
        onPhase(chapter.id, "model1");

        const chunkSize = chunkMode === "full" ? 8000 : 2000;
        const chunks = chunkText(fullyTaggedChineseContent, chunkSize);
        let finalAccumulatedContent = "";
        let finalParsedTitle: string | null = null;

        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const chunk = chunks[chunkIdx];
          if (signal?.aborted) throw new Error("Aborted");

          const system = getSemanticSystemPrompt(
            genreText,
            genreGuidelines,
            customTranslatePrompt,
            customStylePrompt,
          );

          let userPrompt = `[BẢN GỐC TIẾNG TRUNG ĐÃ GẮN THẺ SEMANTIC XML]\n${chunk}\n\nHãy chuyển ngữ sang TIẾNG VIỆT tự nhiên, tuân thủ nghiêm ngặt thuộc tính 'vi' trong các thẻ và 'rule' trong thẻ <dialogue>. Trả kết quả đặt trong thẻ <content>...</content>.`;

          if (chunkIdx === 0) {
            userPrompt = `Tiêu đề chương gốc: ${originalTitle}\n---\n` + userPrompt;
          }

          let rawOutput = "";
          let success = false;
          let lastError = null;
          let activeSystem = system;
          let hasTriedNsfwFallback = false;

          for (let attempt = 0; attempt <= MAX_PERSISTENT_ATTEMPTS * 2; attempt++) {
            if (signal?.aborted) throw new Error("Aborted");

            const attemptController = new AbortController();
            const onAbortMain = () => attemptController.abort();
            if (signal) {
              signal.addEventListener("abort", onAbortMain);
            }

            const timeoutId = setTimeout(() => {
              console.warn(`[Timeout] Cuộc gọi AI vượt quá 100 giây. Chủ động hủy để thử lại...`);
              attemptController.abort();
            }, 100000);

            try {
              const res = await streamText({
                model,
                system: activeSystem,
                prompt: userPrompt,
                abortSignal: attemptController.signal,
                maxOutputTokens: 15000,
              });

              let text = "";
              for await (const t of res.textStream) {
                text += t;
              }

              clearTimeout(timeoutId);
              if (signal) {
                signal.removeEventListener("abort", onAbortMain);
              }

              if (!text.trim()) {
                console.warn(`[Semantic Gen 3] Stream returned empty. Retrying with generateText...`);
                const { generateText } = await import("ai");
                const directRes = await generateText({
                  model,
                  system: activeSystem,
                  prompt: userPrompt,
                  abortSignal: attemptController.signal,
                });
                text = directRes.text;
              }

              // Empty response safety check
              if (!text.trim()) {
                if (!hasTriedNsfwFallback) {
                  hasTriedNsfwFallback = true;
                  console.warn(`[Auto-NSFW] Semantic translate returned empty. Retrying with NSFW R-18+...`);
                  const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                  activeSystem = `${activeSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                  continue;
                }
                throw new Error("AI trả về nội dung trống");
              }

              // Parse thử kết quả để lấy nội dung dịch thực tế
              let parsedContent = "";
              const contentMatch = text.match(/<content>([\s\S]*?)<\/content>/i);
              if (contentMatch) {
                parsedContent = contentMatch[1].trim();
              } else {
                parsedContent = text.replace(/<\/?content>/gi, "").trim();
              }
              parsedContent = cleanResidualXmlTags(parsedContent);
              parsedContent = parsedContent.replace(/^```[\s\S]*?\n/g, "").replace(/```$/g, "").trim();
              parsedContent = parsedContent.replace(/\*\*/g, "").replace(/^###\s+/gm, "").trim();

              // Độ dài bản dịch tiếng Việt kỳ vọng tối thiểu (tiếng Việt dài hơn tiếng Trung khoảng 1.3 - 1.5 lần)
              const expectedMinLength = Math.round(chunk.length * 1.3);
              const charDifference = expectedMinLength - parsedContent.length;

              // Bản dịch bị coi là thiếu hụt nghiêm trọng nếu:
              // 1. Thiếu hụt quá 2000 ký tự so với độ dài tiếng Việt kỳ vọng tối thiểu.
              // 2. Hoặc đối với chunk ngắn: độ dài bản dịch thậm chí ngắn hơn cả bản gốc tiếng Trung,
              //    hoặc ngắn hơn 75% độ dài bản gốc tiếng Trung.
              const isTooShort = charDifference > 2000 || parsedContent.length < Math.min(chunk.length, 1000) || parsedContent.length < chunk.length * 0.75;

              if (isTooShort && !hasTriedNsfwFallback) {
                hasTriedNsfwFallback = true;
                const actualDiff = Math.max(0, expectedMinLength - parsedContent.length);
                console.warn(`[Auto-NSFW] Semantic bản dịch bị thiếu ký tự nghiêm trọng (hụt ~${actualDiff} ký tự). Thử lại với prompt NSFW R-18+...`);
                const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                activeSystem = `${activeSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                continue;
              }

              if (isTooShort) {
                const actualDiff = Math.max(0, expectedMinLength - parsedContent.length);
                throw new Error(`Bản dịch bị cụt/thiếu ký tự nghiêm trọng (hụt ~${actualDiff} ký tự) nghi ngờ do soft safety block`);
              }

              rawOutput = text;
              success = true;

              try {
                const { useAiTranslateLogStore } = await import("@/lib/ai/translate-logger");
                useAiTranslateLogStore.getState().addModel1Log(novelId, {
                  chapterTitle: `${chapter.title} (Phân đoạn ${chunkIdx + 1}/${chunks.length})`,
                  systemPrompt: activeSystem,
                  userPrompt,
                  output: rawOutput,
                  timestamp: new Date(),
                });
              } catch (logErr) {
                console.warn("Failed to log semantic translation:", logErr);
              }

              break;
            } catch (err: any) {
              clearTimeout(timeoutId);
              if (signal) {
                signal.removeEventListener("abort", onAbortMain);
              }

              if (signal?.aborted) {
                throw err;
              }

              let processedError = err;
              if (err?.name === "AbortError" && !signal?.aborted) {
                processedError = new Error("Thời gian phản hồi từ AI vượt quá 100 giây (Timeout). Đang tự động thử lại...");
              }

              lastError = processedError;

              const errMsg = processedError instanceof Error ? processedError.message : String(processedError);
              console.warn(`[Semantic Gen 3] Lượt thử ${attempt} gặp lỗi:`, errMsg);

              if (!hasTriedNsfwFallback) {
                hasTriedNsfwFallback = true;
                console.warn(`[Auto-NSFW] Phát hiện lỗi ở lượt đầu. Tự động kích hoạt prompt NSFW R-18+ bổ sung và thử lại ngay...`);
                const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                activeSystem = `${activeSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                continue;
              }

              // Nếu đã thử kích hoạt NSFW rồi mà vẫn gặp lỗi/cụt chữ ở lượt tiếp theo, ném lỗi thoát ngay lập tức để tránh treo ngầm vô ích
              if (hasTriedNsfwFallback) {
                if (processedError?.name === "AbortError" || errMsg.includes("aborted")) {
                  throw new Error("Cuộc gọi AI vượt quá giới hạn 100 giây ở cả lượt dịch thường và dịch NSFW. Vui lòng kiểm tra lại proxy/mạng hoặc đổi model khác.");
                }
                throw processedError;
              }

              await delay(PERSISTENT_RETRY_DELAY);
            }
          }

          if (!success || !rawOutput.trim()) {
            throw lastError || new Error(`Lỗi cuộc gọi AI ở phân đoạn ${chunkIdx + 1}`);
          }

          // Parse translation tags <content>
          let parsedChunk = "";
          const contentMatch = rawOutput.match(/<content>([\s\S]*?)<\/content>/i);
          if (contentMatch) {
            parsedChunk = contentMatch[1].trim();
          } else {
            parsedChunk = rawOutput.replace(/<\/?content>/gi, "").trim();
          }

          // Strip residual XML tags and markdown
          parsedChunk = cleanResidualXmlTags(parsedChunk);
          parsedChunk = parsedChunk.replace(/^```[\s\S]*?\n/g, "").replace(/```$/g, "").trim();
          parsedChunk = parsedChunk.replace(/\*\*/g, "").replace(/^###\s+/gm, "").trim();

          if (chunkIdx === 0) {
            // Check if Title separator exists
            const titleSepMatch = parsedChunk.match(/\r?\n\s*(?:[-=*#~—]{3,})\s*\r?\n/);
            if (titleSepMatch) {
              const sepIndex = titleSepMatch.index!;
              const sepLength = titleSepMatch[0].length;
              let title = parsedChunk.slice(0, sepIndex).trim();
              title = title.replace(/^(tiêu đề|title)\s*[:：]\s*/i, "").trim();

              if (!title.includes("\n") && title.length < 200) {
                finalParsedTitle = title;
                parsedChunk = parsedChunk.slice(sepIndex + sepLength).trim();
              }
            }
          }

          finalAccumulatedContent += (finalAccumulatedContent ? "\n\n" : "") + parsedChunk;
        }

        // ═══════════════════════════════════════════
        // PHASE 4: Save & Apply Results
        // ═══════════════════════════════════════════
        onPhase(chapter.id, "done");

        let sceneResults: { sceneId: string; content: string }[];
        if (isMultiScene) {
          const parts = splitBySceneBreak(finalAccumulatedContent);
          if (parts.length === chapterScenes.length) {
            sceneResults = chapterScenes.map((s, i) => ({
              sceneId: s.id,
              content: parts[i],
            }));
          } else {
            const splitParts = splitTextIntoParts(finalAccumulatedContent, chapterScenes.length);
            sceneResults = chapterScenes.map((s, i) => ({
              sceneId: s.id,
              content: splitParts[i] || "",
            }));
          }
        } else {
          sceneResults = [{ sceneId: chapterScenes[0].id, content: finalAccumulatedContent }];
        }

        const chapterResult: SemanticTranslateResult = {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          originalTitle: originalTitle,
          newTitle: finalParsedTitle ?? undefined,
          scenes: sceneResults,
          extractedNamesCount: 0,
        };

        // Save to DB Dexie
        const now = new Date();
        if (chapterResult.newTitle) {
          await db.chapters.update(chapter.id, {
            title: chapterResult.newTitle,
            updatedAt: now,
          });
        }
        for (const scene of sceneResults) {
          const existing = await db.scenes.get(scene.sceneId);
          if (existing) {
            const origContent = await getOriginalContent(scene.sceneId);
            await ensureInitialVersion(scene.sceneId, existing.novelId, origContent);
            await createSceneVersion(scene.sceneId, existing.novelId, "ai-translate", scene.content);
          }
          await db.scenes.update(scene.sceneId, {
            content: scene.content,
            versionType: "ai-translate",
            wordCount: countWords(scene.content),
            updatedAt: now,
          });
        }

        onChapterComplete(chapterResult);

        store.setChapterStatus(novelId, chapter.id, "done");
        store.addResult(novelId, {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          originalTitle: originalTitle,
          newTitle: finalParsedTitle ?? undefined,
          originalLineCount: cleanedContent.split("\n").length,
          translatedLineCount: finalAccumulatedContent.split("\n").length,
          scenes: sceneResults,
        });
        store.incrementCompleted(novelId);
      } catch (err: any) {
        console.error(`[Semantic Gen 3] Lỗi dịch chương ${chapter.title}:`, err);
        const errMsg = err instanceof Error ? err.message : String(err);
        onChapterError({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: `Lỗi: ${errMsg}`,
        });

        store.setChapterStatus(novelId, chapter.id, "error");
        store.addError(novelId, {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: errMsg,
        });
        store.incrementCompleted(novelId);

        if (errorAction === "stop") {
          break;
        }
      }
    }
  };

  await runWorker();
  onAllComplete();
}
