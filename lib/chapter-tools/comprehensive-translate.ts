import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db, GENRE_LABELS, resolveChapterOriginalTitle } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict, bulkImportNameEntries } from "@/lib/hooks/use-name-entries";
import { convertText } from "@/lib/hooks/use-qt-engine";
import { chunkText, cleanGarbageLines, isVietnameseText, splitBySceneBreak, splitTextIntoParts } from "@/lib/text-utils";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { isSceneTranslated } from "@/lib/novel-io";
import { scanNewNames, autoAddNames, scanPronounRelations, autoUpdatePronounPrompt } from "./name-scanner";
import { buildQaSystemPrompt, buildQaUserPrompt, parseQaAndApply } from "./qa-helper";
import { checkAndIncrementUsage } from "../usage-limits";
import { checkIsVipStandalone } from "../hooks/use-profile";

// ── Constants ──
const MAX_PERSISTENT_ATTEMPTS = 3;
const PERSISTENT_RETRY_DELAY = 5000;
const SCENE_BREAK = "\n\n[=== SCENE BREAK ===]\n\n";

function getDraftSystemPrompt(
    genreText: string,
    genreGuidelines: string,
    customTranslatePrompt?: string,
    customStylePrompt?: string,
    customPronounPrompt?: string
) {
    let customInstructions = "";
    if (customTranslatePrompt?.trim()) {
        customInstructions += `\n\n# CHỈ DẪN PROMPT DỊCH (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT):\n${customTranslatePrompt.trim()}`;
    }
    if (customStylePrompt?.trim()) {
        customInstructions += `\n\n# CHỈ DẪN VỀ VĂN PHONG DỊCH (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT):\n${customStylePrompt.trim()}`;
    }
    if (customPronounPrompt?.trim()) {
        customInstructions += `\n\n# QUY TẮC XƯNG HÔ & BỐI CẢNH (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT):\n${customPronounPrompt.trim()}`;
    }

    return `# Vai trò
Bạn là một dịch giả kiêm biên tập viên văn học mạng Trung-Việt chuyên nghiệp bậc cao.
Nhiệm vụ của bạn là chuyển ngữ bản dịch thô từ điển (QT) kết hợp bản gốc tiếng Trung sang bản dịch TIẾNG VIỆT trơn tru nhất.

# Thể loại truyện của tác phẩm này: ${genreText}
${genreGuidelines}

# Quy tắc cốt lõi:
1. **Duy trì xưng hô**: Phải tuân thủ tuyệt đối quy tắc xưng hô nhân vật trong bối cảnh cụ thể của bộ truyện.
2. **Phiên âm tên riêng & Nhất quán chính tả tuyệt đối**:
   - Tất cả tên nhân vật, địa danh, môn phái phải được phiên âm Hán-Việt CHUẨN và viết hoa.
   - NGHIÊM CẤM tự ý dịch chệch âm hoặc bỏ bớt/thay đổi nhầm dấu tiếng Việt của tên riêng được cung cấp trong Bảng tên riêng bắt buộc.
3. **Bản dịch đầy đủ 100% (Tuyệt đối không tóm tắt)**: Dịch đầy đủ trọn vẹn 100% nội dung chương truyện. Nghiêm cấm lược dịch, tóm tắt ý hoặc cắt giảm bất kỳ câu chữ nào.
4. **Giữ nguyên dấu phân cảnh**: Nếu có các dấu phân cách phân cảnh (như === SCENE BREAK ===), bạn BẮT BUỘC phải giữ nguyên chính xác 100% vị trí và định dạng của các dấu này, không thay đổi, không dịch nghĩa, không tự viết lại.

# Yêu cầu định dạng đầu ra bắt buộc:
<content>
(Văn bản dịch thô đã được làm mịn bước 1 - TIẾNG VIỆT)
</content>
` + customInstructions;
}

function getEditorSystemPrompt(
    genreText: string,
    genreGuidelines: string,
    customTranslatePrompt?: string,
    customStylePrompt?: string,
    customPronounPrompt?: string
) {
    let customInstructions = "";
    if (customTranslatePrompt?.trim()) {
        customInstructions += `\n\n# CHỈ DẪN PROMPT DỊCH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): \n${customTranslatePrompt.trim()} `;
    }
    if (customStylePrompt?.trim()) {
        customInstructions += `\n\n# CHỈ DẪN VỀ VĂN PHONG DỊCH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): \n${customStylePrompt.trim()} `;
    }
    if (customPronounPrompt?.trim()) {
        customInstructions += `\n\n# QUY TẮC XƯNG HÔ & BỐI CẢNH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): \n${customPronounPrompt.trim()} `;
    }

    return `# Vai trò
Bạn là tổng biên tập văn học kì cựu chuyên biên tập tiểu thuyết dịch tại Việt Nam.
Nhiệm vụ của bạn là đọc bản dịch nháp Tiếng Việt(Draft) dưới đây, đối chiếu bản gốc tiếng Trung để hoàn thiện thành một chương truyện có văn phong trôi chảy, giàu cảm xúc văn học, thuần Việt và không bị thô ráp.

# Thể loại truyện của tác phẩm này: ${genreText}
${genreGuidelines}

# Chỉ dẫn biên tập nâng cao(BẮT BUỘC):
1. **Xóa bỏ phong cách Hán Việt thô cứng**:
   - Tránh các từ lặp / cũ khó hiểu như 'híp híp mắt', 'hướng về', 'bên trong', 'lại một lần nữa', 'kia cái', 'trả về'.
   - Chuyển thành diễn đạt tự nhiên chuẩn thuần Việt(ví dụ: 'nheo mắt cười', 'mắt nhắm lại', 'trong lòng', 'một lần nữa', 'tên kia', 'vẫn còn').
2. **Nhịp điệu câu từ**: Điều chỉnh độ dài ngắn của câu để tạo sự nhịp nhàng, tăng sức truyền cảm cho cảnh chiến đấu, đối thoại hay miêu tả nội tâm.
3. **Nhất quán tên riêng**: Giữ nguyên tên nhân vật, địa danh chính xác tuyệt đối như đã dịch ở bản nháp. Cấm thay đổi dấu tiếng Việt hay làm biến âm tên nhân vật.
4. **Không tùy tiện sáng tác**: Không tự ý thêm bớt tình tiết ngoại truyện hoặc cắt xén cốt truyện gốc.
5. **Bản dịch đầy đủ 100% (Tuyệt đối không tóm tắt)**: Biên tập đầy đủ trọn vẹn 100% nội dung chương truyện, tuyệt đối không được lược dịch, tóm tắt ý hoặc lược bỏ bất kỳ câu chữ nào của bản nháp.
6. **Giữ nguyên dấu phân cảnh**: Giữ nguyên chính xác 100% định dạng và vị trí tất cả các dấu phân cảnh (như === SCENE BREAK ===) có trong bản nháp, không tự ý xóa bỏ hay sửa đổi dấu này.

# Định dạng đầu ra:
<content>
(Bản dịch hoàn thiện cuối cùng sau khi đã được biên tập và chau chuốt xuất sắc - hoàn toàn bằng TIẾNG VIỆT)
</content>
` + customInstructions;
}

function buildDraftUserPrompt(
    chineseText: string,
    dictTranslation: string,
    customTranslatePrompt?: string,
    customStylePrompt?: string,
    customPronounPrompt?: string
): string {
    let userPrompt = `[GỐC - TIẾNG TRUNG]\n${chineseText} \n\n[DỊCH TỪ ĐIỂN QT]\n${dictTranslation} `;

    let customInstructions = "";
    if (customTranslatePrompt?.trim()) {
        customInstructions += `\n - PROMPT DỊCH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): ${customTranslatePrompt.trim()} `;
    }
    if (customStylePrompt?.trim()) {
        customInstructions += `\n - VĂN PHONG DỊCH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): ${customStylePrompt.trim()} `;
    }
    if (customPronounPrompt?.trim()) {
        customInstructions += `\n - QUY TẮC XƯNG HÔ & BỐI CẢNH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): ${customPronounPrompt.trim()} `;
    }

    if (customInstructions) {
        userPrompt += `\n\n⚠️ LƯU Ý BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI VỀ DỊCH THUẬT:${customInstructions} `;
    }

    userPrompt += `\n\nHãy dịch thô mịn đoạn văn trên theo định dạng thẻ < names > và <content>.`;
    return userPrompt;
}

function buildEditorUserPrompt(
    chineseText: string,
    draftTranslation: string,
    customTranslatePrompt?: string,
    customStylePrompt?: string,
    customPronounPrompt?: string
): string {
    let userPrompt = `[BẢN GỐC - CHỮ HÁN]\n${chineseText} \n\n[BẢN DỊCH NHÁP(DRAFT)]\n${draftTranslation} `;

    let customInstructions = "";
    if (customTranslatePrompt?.trim()) {
        customInstructions += `\n - PROMPT DỊCH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): ${customTranslatePrompt.trim()} `;
    }
    if (customStylePrompt?.trim()) {
        customInstructions += `\n - VĂN PHONG DỊCH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): ${customStylePrompt.trim()} `;
    }
    if (customPronounPrompt?.trim()) {
        customInstructions += `\n - QUY TẮC XƯNG HÔ & BỐI CẢNH(BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI - KHÔNG TỰ Ý THÊM BỚT): ${customPronounPrompt.trim()} `;
    }

    if (customInstructions) {
        userPrompt += `\n\n⚠️ LƯU Ý BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI VỀ DỊCH THUẬT:${customInstructions} `;
    }

    userPrompt += `\n\nHãy biên tập lại bản dịch nháp trên thành tiếng Việt văn học trôi chảy nhất nằm trong thẻ <content>.`;
    return userPrompt;
}

// ── Helpers ──
function parseIntermediateResult(xml: string) {
    const extractedNames: { dictType: string; chinese: string; vietnamese: string }[] = [];
    let content = "";

    // Parse names block
    const namesMatch = xml.match(/<names>([\s\S]*?)<\/names>/);
    if (namesMatch && namesMatch[1]) {
        const rawLines = namesMatch[1].split("\n");
        for (const line of rawLines) {
            const match = line.trim().match(/^\[(names|tuvung|ngucanh)\](.*?)=(.*)$/);
            if (match) {
                extractedNames.push({
                    dictType: match[1],
                    chinese: match[2].trim(),
                    vietnamese: match[3].trim(),
                });
            }
        }
    }

    // Parse content block
    const contentMatch = xml.match(/<content>([\s\S]*?)<\/content>/);
    if (contentMatch && contentMatch[1]) {
        content = contentMatch[1].trim();
    } else {
        content = xml.replace(/<names>[\s\S]*?<\/names>/, "").replace(/<\/?content>/g, "").trim();
    }

    return { extractedNames, content };
}

function countWords(s: string) {
    return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

export interface ComprehensiveTranslateResult {
    chapterId: string;
    chapterTitle: string;
    originalTitle: string;
    newTitle: string | undefined;
    scenes: { sceneId: string; content: string }[];
    extractedNamesCount: number;
}

export interface ComprehensiveTranslateOptions {
    novelId: string;
    chapterIds: string[];
    model: LanguageModel;
    qtDictSources?: string[];
    customTranslatePrompt?: string;
    customStylePrompt?: string;
    customPronounPrompt?: string;
    twoPass?: boolean; // Enable two-pass edit/polish pipeline
    skipTranslated?: boolean;
    continuousMode?: boolean;
    extractDict?: boolean; // "Càng dịch càng hay" — extract names + upload to Supabase
    cleanGarbage?: boolean;
    chunkMode?: "chunk" | "full";
    dictModel?: LanguageModel;
    qaModel?: LanguageModel;
    qaEnabled?: boolean;
    qaPrompt?: string;
    errorAction?: "stop" | "skip"; // "stop" = dừng lại khi lỗi, "skip" = bỏ qua chương lỗi
    signal?: AbortSignal;
    delayMs?: number;
    onPhase?: (chapterId: string, phase: string) => void;
    onChapterStart?: (chapterId: string, title: string) => void;
    onChapterComplete?: (res: ComprehensiveTranslateResult) => void;
    onChapterError?: (err: { chapterId: string; chapterTitle: string; message: string }) => void;
    onAllComplete?: () => void;
}

export async function runComprehensiveTranslate(opts: ComprehensiveTranslateOptions) {
    const {
        novelId,
        chapterIds,
        model,
        qtDictSources = ["tienhiep"],
        customTranslatePrompt,
        customStylePrompt,
        customPronounPrompt,
        twoPass = true,
        skipTranslated = true,
        continuousMode = false,
        extractDict = false,
        cleanGarbage = true,
        dictModel,
        qaModel,
        qaEnabled = false,
        qaPrompt,
        errorAction = "stop",
        signal,
        delayMs = 0,
        onPhase = () => { },
        onChapterStart = () => { },
        onChapterComplete = () => { },
        onChapterError = () => { },
        onAllComplete = () => { },
    } = opts;

    const store = useBulkTranslateStore.getState();
    const novel = await db.novels.get(novelId);
    const novelCustomPrompt = novel?.customTranslatePrompt?.trim() || "";
    const novelScanPrompt = novel?.customModel2Prompt?.trim() || novelCustomPrompt;
    const genreKeys = novel?.genres || (novel?.genre ? [novel.genre] : []);
    const genreText = genreKeys.map(k => GENRE_LABELS[k] || k).join(", ") || "Chưa xác định";

    // Build context-specific guidelines based on novel genre
    let genreGuidelines = "";
    if (genreKeys.some(k => ["tienhiep", "huyenhuyen", "dongphuong", "quybi"].includes(k))) {
        genreGuidelines = `
        - ** Đặc trưng Thể loại(Tiên hiệp / Khởi huyễn / Huyền huyen) **: Tông giọng cổ kính, tôn nghiêm, sử dụng từ ngữ Hán Việt văn học cổ phong hợp lý. 
- ** Quy tắc xưng hô **: Ưu tiên cổ phong trang nghiêm(Ta - Ngươi, Huynh - Đệ, Sư tôn - Đồ đệ, Bổn tọa, Các hạ, Tiền bối - Vãn bối).Tránh dùng xưng hô hiện đại trừ phi bối cảnh hài hước / đặc biệt.`;
    } else if (genreKeys.some(k => ["dothi", "hiendai", "school", "hocduong", "vongdu"].includes(k))) {
        genreGuidelines = `
        - ** Đặc trưng Thể loại(Hiện hiện / Đô thị / Võng du) **: Hành văn hiện đại, trẻ trung, đời thường, trôi chảy tự nhiên.
- ** Quy tắc xưng hô **: Linh hoạt theo bối cảnh xã hội hiện đại(Tôi - Cậu, Anh - Em, Ta - Ngươi khi thù địch / khiêu khích, Hắn, Nàng, Gã).Tránh hành văn cổ phong quá đà.`;
    } else if (genreKeys.some(k => ["ngontinh", "dammi"].includes(k))) {
        genreGuidelines = `
        - ** Đặc trưng Thể loại(Ngôn tình / Đam mỹ) **: Văn phong giàu cảm xúc, lãng mạn, mượt mà quyến rũ, tập trung sâu mô tả nội tâm và đường nét cử chỉ.
- ** Quy tắc xưng hô **: Phải sâu lắng và tình cảm(Ta - Chàng / Thiếp nếu cổ đại; Anh - Em, Tôi - Em nếu hiện đại, hoặc các thể loại tự xưng thân mật). Ngăn chặn tình trạng xưng hô lạnh lùng, cứng nhắc.`;
    } else {
        genreGuidelines = `
        - ** Đặc trưng Thể loại **: Xưng hô linh hoạt, tôn trọng văn cảnh và nhịp điệu của thể loại nguyên bản.`;
    }

    const chapterIdSet = new Set(chapterIds);

    store.initJob(novelId);
    store.start(novelId, chapterIds, undefined, undefined);

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
                await new Promise((r) => setTimeout(r, 500));
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
                await new Promise((r) => setTimeout(r, 1000));
                continue;
            }

            const chapId = currentQueue[scanIdx];
            const absoluteScanIdx = allChapters.findIndex(c => c.id === chapId);

            // Block if AI 2 gets > 3 chapters ahead of AI 1
            while (absoluteScanIdx >= 0 && absoluteScanIdx >= currentTranslateIdx + 3) {
                await new Promise((r) => setTimeout(r, 100));
                if (signal?.aborted) break;
            }
            if (signal?.aborted) break;

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

            if (chapter.dictionaryScanned) {
                scannedChapterIds.add(chapId);
                scanIdx++;
                continue;
            }

            // Find scenes
            const chapterScenes = await db.scenes
                .where("chapterId")
                .equals(chapId)
                .toArray();
            chapterScenes.sort((a, b) => a.order - b.order);

            // Check skipTranslated
            if (skipTranslated && chapterScenes.length > 0 && chapterScenes.every(isSceneTranslated)) {
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
                    console.log(`[3-Model Concurrent Pipeline] AI 2 hoàn thành: Đã tự động thêm ${addedCount} từ mới.`);
                    // Cập nhật existingDictMap với các từ vừa quét được
                    for (const n of newlyScannedNames) {
                        existingDictMap.set(n.chinese, n.vietnamese);
                    }
                }

                // Model 2 quét thêm cả xưng hô của các nhân vật nói với nhau
                try {
                    const newlyScannedPronouns = await scanPronounRelations({
                        model: dictModel || model,
                        sourceText: cleanedContent,
                        existingDict: existingDictMap,
                        customScanPrompt: novelScanPrompt,
                        signal,
                    });
                    if (newlyScannedPronouns.length > 0) {
                        const addedPronounCount = await autoUpdatePronounPrompt(novelId, newlyScannedPronouns, existingDictMap);
                        console.log(`[3-Model Concurrent Pipeline] AI 2 hoàn thành: Đã tự động thêm ${addedPronounCount} quy tắc xưng hô mới.`);
                    }
                } catch (scanPronounErr) {
                    console.warn(`[3-Model Concurrent Pipeline] Lỗi quét xưng hô:`, scanPronounErr);
                }
            } catch (scanErr) {
                console.warn(`[3-Model Concurrent Pipeline] Lỗi quét từ điển tại AI 2:`, scanErr);
            }

            await db.chapters.update(chapId, { dictionaryScanned: true });
            store.setChapterStatus(novelId, chapId, "scanned");
            scannedChapterIds.add(chapId);
            scanIdx++;
        }
    };

    // Start background dictionary scanner worker
    runDictWorker();

    const runWorker = async () => {
        while (true) {
            if (signal?.aborted) break;

            // Pause loop
            while (store.jobs[novelId]?.isPaused) {
                await new Promise((r) => setTimeout(r, 1000));
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
            let chapterScenes: any[] = [];
            let currentTranslateIdxVal = 0;

            for (let i = 0; i < currentQueue.length; i++) {
                const cid = currentQueue[i];
                if (processedIds.has(cid)) continue;

                const cScenes = await db.scenes
                    .where("chapterId")
                    .equals(cid)
                    .toArray();
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

            // Update store dynamic total in continuous mode
            if (continuousMode) {
                store.updateTotalChapters(novelId, allChapters.length);
            }

            if (!chapterToProcess) {
                if (continuousMode && pollingAttempts < 15) {
                    pollingAttempts++;
                    await new Promise((r) => setTimeout(r, 3000));
                    continue;
                }
                break; // No more chapters
            }

            pollingAttempts = 0;
            currentTranslateIdx = currentTranslateIdxVal;

            // Wait until AI 2 completes scanning for this chapter
            const activeChapterId = chapterToProcess.id;
            while (!scannedChapterIds.has(activeChapterId)) {
                await new Promise((r) => setTimeout(r, 100));
                if (signal?.aborted) break;
            }
            if (signal?.aborted) break;

            // Double check pause after waiting
            while (store.jobs[novelId]?.isPaused) {
                await new Promise((r) => setTimeout(r, 500));
                if (signal?.aborted) break;
            }
            if (signal?.aborted) break;

            processedIds.add(activeChapterId);
            const chapter = chapterToProcess;
            const originalTitle = await resolveChapterOriginalTitle(chapter);

            onChapterStart(chapter.id, chapter.title);
            store.setChapterStatus(novelId, chapter.id, "translating");

            try {
                // Merge raw texts first to check if already in Vietnamese
                const isMultiScene = chapterScenes.length > 1;
                const rawTexts = await Promise.all(chapterScenes.map((s) => getOriginalContent(s.id)));
                const cleanedContent = rawTexts.join(SCENE_BREAK);

                // Check if original content is already Vietnamese
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

                // Delay if needed
                if (delayMs > 0) {
                    await new Promise((r) => setTimeout(r, delayMs));
                }

                onPhase(chapter.id, "dict");

                // Fetch dictionary
                let nameDict = await getMergedNameDict(novelId);

                // Run local QT dict translation for Title
                let dictTranslatedTitle = "";
                const titleRes = await convertText(originalTitle, {
                    novelNames: nameDict,
                    options: { activeDictSources: qtDictSources },
                });
                dictTranslatedTitle = titleRes.plainText;

                // Cut into chunks for AI
                const chunkSize = opts.chunkMode === "full" ? 8000 : 1600;
                const chunks = chunkText(cleanedContent, chunkSize);
                let finalAccumulatedContent = "";
                let finalParsedTitle: string | null = null;
                let totalExtractedNamesCount = 0;

                for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
                    const chunk = chunks[chunkIdx];
                    if (signal?.aborted) throw new Error("Aborted");

                    onPhase(chapter.id, "ai");

                    // Translate dynamically using active name dictionary
                    const chunkRes = await convertText(chunk, {
                        novelNames: nameDict,
                        options: { activeDictSources: qtDictSources },
                    });
                    const chunkDictTranslated = chunkRes.plainText;

                    // Run Phase 1: Draft translate
                    const draftSystem = getDraftSystemPrompt(
                        genreText,
                        genreGuidelines,
                        customTranslatePrompt,
                        customStylePrompt,
                        customPronounPrompt
                    );

                    // Relevant name injection
                    let relevantNamesPrompt = "";
                    const relevantNames = nameDict.filter((n) =>
                        chunk.includes(n.chinese) &&
                        ["nhân vật", "địa danh", "môn phái", "bang hội", "tên riêng", "thuật ngữ", "context mapping", "khác", "tuvung", "ngucanh"].includes(n.category)
                    ).sort((a, b) => b.chinese.length - a.chinese.length);

                    if (relevantNames.length > 0) {
                        relevantNamesPrompt = `\n\n# Bảng tên riêng bắt buộc dùng đúng: \n`;
                        for (const n of relevantNames.slice(0, 150)) {
                            relevantNamesPrompt += `${n.chinese} → ${n.vietnamese} \n`;
                        }
                    }

                    const draftUser = buildDraftUserPrompt(
                        chunk,
                        chunkDictTranslated,
                        customTranslatePrompt,
                        customStylePrompt,
                        customPronounPrompt
                    ) + relevantNamesPrompt;

                    let rawDraftOutput = "";
                    let draftSuccess = false;
                    let lastDraftError = null;
                    let activeDraftSystem = draftSystem;
                    let hasTriedNsfwDraftFallback = false;

                    for (let attempt = 0; attempt <= MAX_PERSISTENT_ATTEMPTS * 2; attempt++) {
                        if (signal?.aborted) throw new Error("Aborted");

                        const attemptController = new AbortController();
                        const onAbortMain = () => attemptController.abort();
                        if (signal) {
                            signal.addEventListener("abort", onAbortMain);
                        }

                        const timeoutId = setTimeout(() => {
                            console.warn(`[Timeout] Cuộc gọi Comprehensive Draft vượt quá 100 giây. Chủ động hủy để thử lại...`);
                            attemptController.abort();
                        }, 100000);

                        try {
                            const res = await streamText({
                                model,
                                system: activeDraftSystem,
                                prompt: draftUser,
                                abortSignal: attemptController.signal,
                                maxOutputTokens: 10000,
                            });

                            let text = "";
                            for await (const t of res.textStream) {
                                text += t;
                            }

                            clearTimeout(timeoutId);
                            if (signal) {
                                signal.removeEventListener("abort", onAbortMain);
                            }

                            // Streaming fallback
                            if (!text.trim()) {
                                console.warn(`[AI Draft] Stream returned empty.Retrying with generateText...`);
                                const { generateText } = await import("ai");
                                const directRes = await generateText({
                                    model,
                                    system: activeDraftSystem,
                                    prompt: draftUser,
                                    abortSignal: attemptController.signal,
                                });
                                text = directRes.text;
                            }

                            // Empty response retry (potential safety block)
                            if (!text.trim()) {
                                if (!hasTriedNsfwDraftFallback) {
                                    hasTriedNsfwDraftFallback = true;
                                    console.warn(`[Auto-NSFW] Draft returned empty. Retrying with NSFW R-18+ prompt...`);
                                    const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                                    activeDraftSystem = `${activeDraftSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                                    continue;
                                }
                                throw new Error("AI trả về nội dung trống nghi ngờ do bộ lọc an toàn");
                            }

                            // Parse thử kết quả để kiểm tra hụt chữ
                            const parsedDraft = parseIntermediateResult(text);
                            const parsedContent = parsedDraft.content || "";

                            // Độ dài bản dịch tiếng Việt kỳ vọng tối thiểu (tiếng Việt dài hơn tiếng Trung khoảng 1.3 - 1.5 lần)
                            const expectedMinLength = Math.round(chunk.length * 1.3);
                            const charDifference = expectedMinLength - parsedContent.length;

                            // Bản dịch bị coi là thiếu hụt nghiêm trọng nếu:
                            // 1. Thiếu hụt quá 2000 ký tự so với độ dài tiếng Việt kỳ vọng tối thiểu.
                            // 2. Hoặc đối với chunk ngắn: độ dài bản dịch thậm chí ngắn hơn cả bản gốc tiếng Trung,
                            //    hoặc ngắn hơn 75% độ dài bản gốc tiếng Trung.
                            const isTooShort = charDifference > 2000 || parsedContent.length < Math.min(chunk.length, 1000) || parsedContent.length < chunk.length * 0.75;

                            if (isTooShort && !hasTriedNsfwDraftFallback) {
                                hasTriedNsfwDraftFallback = true;
                                const actualDiff = Math.max(0, expectedMinLength - parsedContent.length);
                                console.warn(`[Auto-NSFW] Comprehensive Draft bản dịch bị thiếu ký tự nghiêm trọng (hụt ~${actualDiff} ký tự). Thử lại với prompt NSFW R-18+...`);
                                const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                                activeDraftSystem = `${activeDraftSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                                continue;
                            }

                            if (isTooShort) {
                                const actualDiff = Math.max(0, expectedMinLength - parsedContent.length);
                                throw new Error(`Bản dịch nháp bị cụt/thiếu ký tự nghiêm trọng (hụt ~${actualDiff} ký tự) nghi ngờ do soft safety block`);
                            }

                            rawDraftOutput = text;
                            draftSuccess = true;
                            break;
                        } catch (err: any) {
                            clearTimeout(timeoutId);
                            if (signal) {
                                signal.removeEventListener("abort", onAbortMain);
                            }

                            if (signal?.aborted) {
                                throw err;
                            }

                            lastDraftError = err;
                            const errMsg = err instanceof Error ? err.message : String(err);
                            console.warn(`[Comp Draft] Lượt thử ${attempt} gặp lỗi:`, errMsg);

                            if (!hasTriedNsfwDraftFallback) {
                                hasTriedNsfwDraftFallback = true;
                                console.warn(`[Auto-NSFW] Lỗi lượt đầu ở Comp Draft. Tự động kích hoạt prompt NSFW R-18+ và thử lại...`);
                                const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                                activeDraftSystem = `${activeDraftSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                                continue;
                            }

                            // Nếu đã thử kích hoạt NSFW rồi mà vẫn gặp lỗi/cụt chữ ở lượt tiếp theo, ném lỗi thoát ngay lập tức để tránh treo ngầm vô ích
                            if (hasTriedNsfwDraftFallback) {
                                if (err?.name === "AbortError" || String(err).includes("aborted")) {
                                    throw new Error("Cuộc gọi AI Draft vượt quá giới hạn 100 giây ở cả lượt thường và dịch NSFW. Vui lòng kiểm tra proxy/mạng.");
                                }
                                throw err;
                            }

                            await new Promise((r) => setTimeout(r, PERSISTENT_RETRY_DELAY));
                        }
                    }

                    if (!draftSuccess || !rawDraftOutput.trim()) {
                        throw lastDraftError || new Error(`Không dịch được bản nháp tại đoạn ${chunkIdx + 1} `);
                    }

                    // Parse draft
                    const parsedDraft = parseIntermediateResult(rawDraftOutput);
                    if (chunkIdx === 0) finalParsedTitle = dictTranslatedTitle; // Fallback to QT title translate

                    // Save extracted names to DB
                    if (parsedDraft.extractedNames.length > 0) {
                        try {
                            const entriesWithCategory = parsedDraft.extractedNames.map((entry) => {
                                let category = "khác";
                                if (entry.dictType === "names") category = "nhân vật";
                                else if (entry.dictType === "tuvung") category = "thuật ngữ";
                                else if (entry.dictType === "ngucanh") category = "context mapping";
                                return { ...entry, category };
                            });
                            await bulkImportNameEntries(novelId, entriesWithCategory, "khác", "skip");
                            totalExtractedNamesCount += parsedDraft.extractedNames.length;
                            nameDict = await getMergedNameDict(novelId);
                        } catch { }
                    }

                    if (!parsedDraft.content?.trim()) {
                        throw new Error(`AI dịch nháp trả về nội dung trống ở đoạn ${chunkIdx + 1} `);
                    }
                    let finalChunkContent = parsedDraft.content;

                    // Run Phase 2 (Optional Polish / Editorial Pass)
                    if (twoPass) {
                        const editSystem = getEditorSystemPrompt(
                            genreText,
                            genreGuidelines,
                            customTranslatePrompt,
                            customStylePrompt,
                            customPronounPrompt
                        );

                        const editUser = buildEditorUserPrompt(
                            chunk,
                            finalChunkContent,
                            customTranslatePrompt,
                            customStylePrompt,
                            customPronounPrompt
                        );

                        let editSuccess = false;
                        let lastEditError = null;
                        let rawEditOutput = "";
                        let activeEditSystem = editSystem;
                        let hasTriedNsfwEditFallback = false;

                        for (let attempt = 0; attempt <= MAX_PERSISTENT_ATTEMPTS * 2; attempt++) {
                            if (signal?.aborted) throw new Error("Aborted");

                            const attemptController = new AbortController();
                            const onAbortMain = () => attemptController.abort();
                            if (signal) {
                                signal.addEventListener("abort", onAbortMain);
                            }

                            const timeoutId = setTimeout(() => {
                                console.warn(`[Timeout] Cuộc gọi Comprehensive Editor vượt quá 100 giây. Chủ động hủy để thử lại...`);
                                attemptController.abort();
                            }, 100000);

                            try {
                                const res = await streamText({
                                    model,
                                    system: activeEditSystem,
                                    prompt: editUser,
                                    abortSignal: attemptController.signal,
                                    maxOutputTokens: 10000,
                                });
                                let text = "";
                                for await (const t of res.textStream) {
                                    text += t;
                                }

                                clearTimeout(timeoutId);
                                if (signal) {
                                    signal.removeEventListener("abort", onAbortMain);
                                }

                                // Streaming fallback
                                if (!text.trim()) {
                                    console.warn(`[AI Editor] Stream returned empty.Retrying with generateText...`);
                                    const { generateText } = await import("ai");
                                    const directRes = await generateText({
                                        model,
                                        system: activeEditSystem,
                                        prompt: editUser,
                                        abortSignal: attemptController.signal,
                                    });
                                    text = directRes.text;
                                }

                                // Empty response retry (potential safety block)
                                if (!text.trim()) {
                                    if (!hasTriedNsfwEditFallback) {
                                        hasTriedNsfwEditFallback = true;
                                        console.warn(`[Auto-NSFW] Editor returned empty. Retrying with NSFW R-18+ prompt...`);
                                        const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                                        activeEditSystem = `${activeEditSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                                        continue;
                                    }
                                    throw new Error("AI biên tập trả về nội dung trống nghi ngờ do bộ lọc an toàn");
                                }

                                // Parse thử kết quả biên tập để kiểm tra hụt chữ so với bản nháp
                                const parsedEdit = parseIntermediateResult(text);
                                const editContent = parsedEdit.content || "";

                                // Bản dịch biên tập bị coi là hụt nghiêm trọng nếu ngắn hơn 75% độ dài bản dịch nháp
                                const isEditTooShort = editContent.length < finalChunkContent.length * 0.75;

                                if (isEditTooShort && !hasTriedNsfwEditFallback) {
                                    hasTriedNsfwEditFallback = true;
                                    console.warn(`[Auto-NSFW] Comprehensive Editor bản dịch bị hụt nghiêm trọng so với bản nháp (nháp: ${finalChunkContent.length}, biên tập: ${editContent.length}). Thử lại với prompt NSFW R-18+...`);
                                    const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                                    activeEditSystem = `${activeEditSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                                    continue;
                                }

                                if (isEditTooShort) {
                                    throw new Error(`Bản dịch biên tập bị cụt/thiếu ký tự nghiêm trọng so với bản dịch nháp nghi ngờ do soft safety block`);
                                }

                                rawEditOutput = text;
                                editSuccess = true;
                                break;
                            } catch (err: any) {
                                clearTimeout(timeoutId);
                                if (signal) {
                                    signal.removeEventListener("abort", onAbortMain);
                                }

                                if (signal?.aborted) {
                                    throw err;
                                }

                                lastEditError = err;
                                const errMsg = err instanceof Error ? err.message : String(err);
                                console.warn(`[Comp Editor] Lượt thử ${attempt} gặp lỗi:`, errMsg);

                                if (!hasTriedNsfwEditFallback) {
                                    hasTriedNsfwEditFallback = true;
                                    console.warn(`[Auto-NSFW] Lỗi lượt đầu ở Comp Editor. Tự động kích hoạt prompt NSFW R-18+ và thử lại...`);
                                    const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
                                    activeEditSystem = `${activeEditSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
                                    continue;
                                }

                                // Nếu đã thử kích hoạt NSFW rồi mà vẫn gặp lỗi/cụt chữ ở lượt tiếp theo, ném lỗi thoát ngay lập tức để tránh treo ngầm vô ích
                                if (hasTriedNsfwEditFallback) {
                                    if (err?.name === "AbortError" || String(err).includes("aborted")) {
                                        throw new Error("Cuộc gọi AI Editor vượt quá giới hạn 100 giây ở cả lượt thường và biên tập NSFW. Vui lòng kiểm tra proxy/mạng.");
                                    }
                                    throw err;
                                }

                                await new Promise((r) => setTimeout(r, PERSISTENT_RETRY_DELAY));
                            }
                        }

                        if (!editSuccess || !rawEditOutput.trim()) {
                            throw lastEditError || new Error(`Không dịch được bản biên tập tại đoạn ${chunkIdx + 1} `);
                        }

                        const parsedEdit = parseIntermediateResult(rawEditOutput);
                        if (!parsedEdit.content?.trim()) {
                            throw new Error(`AI biên tập trả về nội dung trống ở đoạn ${chunkIdx + 1} `);
                        }
                        finalChunkContent = parsedEdit.content;
                    }

                    // ═══════════════════════════════════════════
                    // PHASE 2c: Model 3 QA Bot (Audit & Refine)
                    // ═══════════════════════════════════════════
                    if (qaEnabled && qaModel) {
                        onPhase(chapter.id, "model3");
                        console.log(`[3-Model Pipeline] Đang chạy QA Bot tối ưu hóa đoạn ${chunkIdx + 1}/${chunks.length}...`);
                        const qaSystemPrompt = buildQaSystemPrompt(chunk, nameDict, qaPrompt, customPronounPrompt);
                        const qaUserPrompt = buildQaUserPrompt(chunk, chunkDictTranslated, finalChunkContent);

                        let qaResult = "";
                        let qaError: unknown = null;
                        for (let qaAttempt = 0; qaAttempt < 2; qaAttempt++) {
                            try {
                                const { generateText } = await import("ai");
                                const res = await generateText({
                                    model: qaModel,
                                    system: qaSystemPrompt,
                                    prompt: qaUserPrompt,
                                    abortSignal: signal,
                                });
                                qaResult = res.text ?? "";
                                if (qaResult.trim()) break;
                            } catch (err) {
                                qaError = err;
                                await new Promise((r) => setTimeout(r, 1000));
                            }
                        }
                        if (qaResult.trim()) {
                            finalChunkContent = parseQaAndApply(qaResult, finalChunkContent);
                        } else {
                            console.warn(`[3-Model Pipeline] QA Bot chunk ${chunkIdx + 1} trả về kết quả rỗng hoặc lỗi:`, qaError);
                        }
                    }

                    finalAccumulatedContent += (finalAccumulatedContent ? "\n\n" : "") + finalChunkContent;
                } // end of chunks loop

                // Map content back to scenes
                let finalParsedScenes = [];
                if (isMultiScene) {
                    const parts = splitBySceneBreak(finalAccumulatedContent);
                    if (parts.length === chapterScenes.length) {
                        finalParsedScenes = chapterScenes.map((s, i) => ({
                            sceneId: s.id,
                            content: parts[i],
                        }));
                    } else {
                        // Fallback to splitting by paragraph boundaries
                        const splitParts = splitTextIntoParts(finalAccumulatedContent, chapterScenes.length);
                        finalParsedScenes = chapterScenes.map((s, i) => ({
                            sceneId: s.id,
                            content: splitParts[i] || "",
                        }));
                    }
                } else {
                    finalParsedScenes = [{ sceneId: chapterScenes[0].id, content: finalAccumulatedContent }];
                }

                onPhase(chapter.id, "done");

                // Save backend updates
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

            } catch (err: any) {
                if (err.name === "AbortError" || signal?.aborted) break;
                const msg = err instanceof Error ? err.message : "Dịch thất bại";
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
        }
    };

    await runWorker();

    if (signal?.aborted) {
        store.cancel(novelId);
    } else {
        store.finish(novelId);
        onAllComplete();
    }
}
