import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db, GENRE_LABELS } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict, bulkImportNameEntries } from "@/lib/hooks/use-name-entries";
import { convertText } from "@/lib/hooks/use-qt-engine";
import { chunkText } from "@/lib/text-utils";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { isSceneTranslated } from "@/lib/novel-io";

// ── Constants ──
const MAX_PERSISTENT_ATTEMPTS = 3;
const PERSISTENT_RETRY_DELAY = 5000;
const SCENE_BREAK = "\n\n[=== SCENE BREAK ===]\n\n";

function getDraftSystemPrompt(
    genreText: string,
    genreGuidelines: string,
    novelCustomPrompt?: string,
    stylePreset?: string,
    pronounMatrix?: string,
    pronounMatrixEnabled?: boolean
) {
    let styleInstruction = "";
    if (stylePreset === "epic") {
        styleInstruction = `\n- **Phong cách Dịch (Hùng tráng - Kịch tính)**: Hành văn dồn dập, hào hùng, kịch tính. Sử dụng các câu mô tả ngắn gọn, dứt khoát trong phân cảnh hành động, chiến đấu. Ưu tiên các động từ mạnh mẽ, hùng tráng.`;
    } else if (stylePreset === "poetic") {
        styleInstruction = `\n- **Phong cách Dịch (Bay bổng - Cổ phong/Kiếm hiệp)**: Hành văn mềm mại, cổ kính, giàu tính nhạc họa. Chăm chút kỹ phần miêu tả phong cảnh, tâm cảnh tu đạo bản sắc võ hiệp/tiên hiệp cổ đại, ưu tiên từ Hán Việt mỹ lệ trang nhã.`;
    } else if (stylePreset === "modern") {
        styleInstruction = `\n- **Phong cách Dịch (Đời thường - Hiện đại)**: Hành văn tự nhiên, bình dị, thuần Việt hiện đại hằng ngày. Câu cú gãy gọn dễ hiểu, tránh các từ Hán Việt cổ hoặc trang nghiêm quá đà.`;
    } else if (stylePreset === "romantic") {
        styleInstruction = `\n- **Phong cách Dịch (Ngọt ngào - Tình cảm)**: Hành văn lãng mạn, giàu cảm xúc, chú trọng mô tả đường nét cử chỉ, tâm lý, nội tâm ấm áp/quyến rũ của các nhân vật.`;
    }

    let pronounMatrixInstruction = "";
    if (pronounMatrixEnabled && pronounMatrix && pronounMatrix.trim()) {
        pronounMatrixInstruction = `\n\n# Ma trận xưng hô cặp nhân vật bắt buộc (Khi A nói chuyện với B, hoặc xuất hiện cùng nhau):
${pronounMatrix.trim()}
⚠️ Bạn phải phân tích kỹ hội thoại hoặc hành động giữa các nhân vật này và dùng đúng đại từ đối xứng mẫu trên.`;
    }

    return `# Vai trò
Bạn là một dịch giả kiêm biên tập viên văn học mạng Trung-Việt chuyên nghiệp bậc cao.
Nhiệm vụ của bạn là chuyển ngữ bản dịch thô từ điển (QT) kết hợp bản gốc tiếng Trung sang bản dịch TIẾNG VIỆT trơn tru nhất.

# Thể loại truyện của tác phẩm này: ${genreText}
${genreGuidelines}${styleInstruction}${pronounMatrixInstruction}

# Quy tắc cốt lõi:
1. **Duy trì xưng hô**: Phải tuân thủ tuyệt đối quy tắc xưng hô nhân vật trong bối cảnh cụ thể của bộ truyện (ví dụ: Tiên hiệp dùng Ta/Ngươi, Sư huynh/Sư đệ, Đồ nhi/Sư tôn, Bản tọa/Các hạ).
2. **Phiên âm tên riêng & Nhất quán chính tả tuyệt đối**:
   - Tất cả tên nhân vật, địa danh, môn phái phải được phiên âm Hán-Việt CHUẨN và viết hoa.
   - NGHIÊM CẤM tự ý dịch chệch âm hoặc bỏ bớt/thay đổi nhầm dấu tiếng Việt của tên riêng được cung cấp trong Bảng tên riêng bắt buộc (ví dụ: Tên trong bảng là "Trần Phàm" thì KHÔNG được viết thành "Trần Pham", "Trần Phạm" hay bất kỳ ký tự nào khác. Dùng nguyên văn từ bảng!).
3. **Trích xuất tên mới**: Nếu phát hiện tên riêng mới hoặc thuật ngữ mới chưa có trong Bảng tên riêng, hãy trích xuất sang thẻ <names>.

# Yêu cầu định dạng đầu ra bắt buộc:
<names>
[names]TênChữHán=TênTiếngViệt
[tuvung]ThuậtNgữHán=GiảiNghĩaViệt
</names>
<content>
(Văn bản dịch thô đã được làm mịn bước 1 - TIẾNG VIỆT)
</content>
` + (novelCustomPrompt?.trim() ? `\n\n# Quy tắc xưng hô riêng của người dùng đặt ra (ƯU TIÊN TUÂN THỦ TUYỆT ĐỐI):\n${novelCustomPrompt.trim()}` : "");
}

function getEditorSystemPrompt(
    genreText: string,
    genreGuidelines: string,
    novelCustomPrompt?: string,
    stylePreset?: string,
    pronounMatrix?: string,
    pronounMatrixEnabled?: boolean
) {
    let styleInstruction = "";
    if (stylePreset === "epic") {
        styleInstruction = `\n- **Phong cách Dịch (Hùng tráng - Kịch tính)**: Hành văn dồn dập, hào hùng, kịch tính. Sử dụng các câu mô tả ngắn gọn, dứt khoát trong phân cảnh hành động, chiến đấu. Ưu tiên các động từ mạnh mẽ, hùng tráng.`;
    } else if (stylePreset === "poetic") {
        styleInstruction = `\n- **Phong cách Dịch (Bay bổng - Cổ phong/Kiếm hiệp)**: Hành văn mềm mại, cổ kính, giàu tính nhạc họa. Chăm chút kỹ phần miêu tả phong cảnh, tâm cảnh tu đạo bản sắc võ hiệp/tiên hiệp cổ đại, ưu tiên từ Hán Việt mỹ lệ trang nhã.`;
    } else if (stylePreset === "modern") {
        styleInstruction = `\n- **Phong cách Dịch (Đời thường - Hiện đại)**: Hành văn tự nhiên, bình dị, thuần Việt hiện đại hằng ngày. Câu cú gãy gọn dễ hiểu, tránh các từ Hán Việt cổ hoặc trang nghiêm quá đà.`;
    } else if (stylePreset === "romantic") {
        styleInstruction = `\n- **Phong cách Dịch (Ngọt ngào - Tình cảm)**: Hành văn lãng mạn, giàu cảm xúc, chú trọng mô tả đường nét cử chỉ, tâm lý, nội tâm ấm áp/quyến rũ của các nhân vật.`;
    }

    let pronounMatrixInstruction = "";
    if (pronounMatrixEnabled && pronounMatrix && pronounMatrix.trim()) {
        pronounMatrixInstruction = `\n\n# Ma trận xưng hô cặp nhân vật bắt buộc (Khi A nói chuyện với B, hoặc xuất hiện cùng nhau):
${pronounMatrix.trim()}
⚠️ Bạn phải phân tích kỹ hội thoại hoặc hành động giữa các nhân vật này và dùng đúng đại từ đối xứng mẫu trên.`;
    }

    return `# Vai trò
Bạn là tổng biên tập văn học kì cựu chuyên biên tập tiểu thuyết dịch tại Việt Nam.
Nhiệm vụ của bạn là đọc bản dịch nháp Tiếng Việt (Draft) dưới đây, đối chiếu bản gốc tiếng Trung để hoàn thiện thành một chương truyện có văn phong trôi chảy, giàu cảm xúc văn học, thuần Việt và không bị thô ráp.

# Thể loại truyện của tác phẩm này: ${genreText}
${genreGuidelines}${styleInstruction}${pronounMatrixInstruction}

# Chỉ dẫn biên tập nâng cao (BẮT BUỘC):
1. **Xóa bỏ phong cách Hán Việt thô cứng**:
   - Tránh các từ lặp/cũ khó hiểu như 'híp híp mắt', 'hướng về', 'bên trong', 'lại một lần nữa', 'kia cái', 'trả về'.
   - Chuyển thành diễn đạt tự nhiên chuẩn thuần Việt (ví dụ: 'nheo mắt cười', 'mắt nhắm lại', 'trong lòng', 'một lần nữa', 'tên kia', 'vẫn còn').
2. **Nhịp điệu câu từ**: Điều chỉnh độ dài ngắn của câu để tạo sự nhịp nhàng, tăng sức truyền cảm cho cảnh chiến đấu, đối thoại hay miêu tả nội tâm.
3. **Nhất quán tên riêng**: Giữ nguyên tên nhân vật, địa danh chính xác tuyệt đối như đã dịch ở bản nháp. Cấm thay đổi dấu tiếng Việt hay làm biến âm tên nhân vật (ví dụ: "Trần Phàm" phải giữ là "Trần Phàm", không được gõ nhanh hay sửa lỗi chính tả tự động thành "Trần Pham" hoặc "Trần Phạm").
4. **Không tùy tiện sáng tác**: Không tự ý thêm bớt tình tiết ngoại truyện hoặc cắt xén cốt truyện gốc.

# Định dạng đầu ra:
<content>
(Bản dịch hoàn thiện cuối cùng sau khi đã được biên tập và chau chuốt xuất sắc - hoàn toàn bằng TIẾNG VIỆT)
</content>
` + (novelCustomPrompt?.trim() ? `\n\n# Quy tắc xưng hô riêng của người dùng đặt ra (ƯU TIÊN TUÂN THỦ TUYỆT ĐỐI):\n${novelCustomPrompt.trim()}` : "");
}

function buildDraftUserPrompt(
    chineseText: string,
    dictTranslation: string,
    novelCustomPrompt?: string
): string {
    let userPrompt = `[GỐC - TIẾNG TRUNG]\n${chineseText}\n\n[DỊCH TỪ ĐIỂN QT]\n${dictTranslation}`;

    if (novelCustomPrompt && novelCustomPrompt.trim()) {
        userPrompt += `\n\n⚠️ LƯU Ý BẮT BUỘC VỀ XƯNG HÔ/PHONG CÁCH:\n${novelCustomPrompt.trim()}`;
    }

    userPrompt += `\n\nHãy dịch thô mịn đoạn văn trên theo định dạng thẻ <names> và <content>.`;
    return userPrompt;
}

function buildEditorUserPrompt(
    chineseText: string,
    draftTranslation: string,
    novelCustomPrompt?: string
): string {
    let userPrompt = `[BẢN GỐC - CHỮ HÁN]\n${chineseText}\n\n[BẢN DỊCH NHÁP (DRAFT)]\n${draftTranslation}`;

    if (novelCustomPrompt && novelCustomPrompt.trim()) {
        userPrompt += `\n\n⚠️ LƯU Ý BẮT BUỘC VỀ XƯNG HÔ/PHONG CÁCH:\n${novelCustomPrompt.trim()}`;
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
    novelCustomPrompt?: string;
    twoPass?: boolean; // Enable two-pass edit/polish pipeline
    skipTranslated?: boolean;
    continuousMode?: boolean;
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
        novelCustomPrompt,
        twoPass = true,
        skipTranslated = true,
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
    const genreKeys = novel?.genres || (novel?.genre ? [novel.genre] : []);
    const genreText = genreKeys.map(k => GENRE_LABELS[k] || k).join(", ") || "Chưa xác định";

    // Build context-specific guidelines based on novel genre
    let genreGuidelines = "";
    if (genreKeys.some(k => ["tienhiep", "huyenhuyen", "dongphuong", "quybi"].includes(k))) {
        genreGuidelines = `
- **Đặc trưng Thể loại (Tiên hiệp/Khởi huyễn/Huyền huyễn)**: Tông giọng cổ kính, tôn nghiêm, sử dụng từ ngữ Hán Việt văn học cổ phong hợp lý. 
- **Quy tắc xưng hô**: Ưu tiên cổ phong trang nghiêm (Ta - Ngươi, Huynh - Đệ, Sư tôn - Đồ đệ, Bổn tọa, Các hạ, Tiền bối - Vãn bối). Tránh dùng xưng hô hiện đại trừ phi bối cảnh hài hước/đặc biệt.`;
    } else if (genreKeys.some(k => ["dothi", "hiendai", "school", "hocduong", "vongdu"].includes(k))) {
        genreGuidelines = `
- **Đặc trưng Thể loại (Hiện hiện/Đô thị/Võng du)**: Hành văn hiện đại, trẻ trung, đời thường, trôi chảy tự nhiên.
- **Quy tắc xưng hô**: Linh hoạt theo bối cảnh xã hội hiện đại (Tôi - Cậu, Anh - Em, Ta - Ngươi khi thù địch/khiêu khích, Hắn, Nàng, Gã). Tránh hành văn cổ phong quá đà.`;
    } else if (genreKeys.some(k => ["ngontinh", "dammi"].includes(k))) {
        genreGuidelines = `
- **Đặc trưng Thể loại (Ngôn tình/Đam mỹ)**: Văn phong giàu cảm xúc, lãng mạn, mượt mà quyến rũ, tập trung sâu mô tả nội tâm và đường nét cử chỉ.
- **Quy tắc xưng hô**: Phải sâu lắng và tình cảm (Ta - Chàng/Thiếp nếu cổ đại; Anh - Em, Tôi - Em nếu hiện đại, hoặc các thể loại tự xưng thân mật). Ngăn chặn tình trạng xưng hô lạnh lùng, cứng nhắc.`;
    } else {
        genreGuidelines = `
- **Đặc trưng Thể loại**: Xưng hô linh hoạt, tôn trọng văn cảnh và nhịp điệu của thể loại nguyên bản.`;
    }

    const queue = [...chapterIds];

    const runWorker = async () => {
        while (queue.length > 0 && !signal?.aborted) {
            const chapterId = queue.shift();
            if (!chapterId) break;

            const chapter = await db.chapters.get(chapterId);
            if (!chapter) continue;

            onChapterStart(chapter.id, chapter.title);
            store.setChapterStatus(novelId, chapter.id, "translating");

            try {
                // Find scenes
                const scenes = await db.scenes
                    .where("[novelId+isActive]")
                    .equals([novelId, 1])
                    .toArray();

                const chapterScenes = scenes
                    .filter((s) => s.chapterId === chapter.id)
                    .sort((a, b) => a.order - b.order);

                if (chapterScenes.length === 0) {
                    throw new Error("Không tìm thấy phân cảnh nào của chương này.");
                }

                // Check skip
                if (skipTranslated) {
                    let allTranslated = true;
                    for (const s of chapterScenes) {
                        if (!isSceneTranslated(s)) {
                            allTranslated = false;
                            break;
                        }
                    }
                    if (allTranslated) {
                        onChapterComplete({
                            chapterId: chapter.id,
                            chapterTitle: chapter.title,
                            originalTitle: chapter.title,
                            newTitle: chapter.title,
                            scenes: chapterScenes.map((s) => ({ sceneId: s.id, content: s.content })),
                            extractedNamesCount: 0,
                        });
                        store.setChapterStatus(novelId, chapter.id, "done");
                        store.incrementCompleted(novelId);
                        continue;
                    }
                }

                // Delay if needed
                if (delayMs > 0) {
                    await new Promise((r) => setTimeout(r, delayMs));
                }

                onPhase(chapter.id, "dict");

                // Merge raw texts
                const isMultiScene = chapterScenes.length > 1;
                const rawTexts = await Promise.all(chapterScenes.map((s) => getOriginalContent(s.id)));
                const cleanedContent = rawTexts.join(SCENE_BREAK);

                // Fetch dictionary
                let nameDict = await getMergedNameDict(novelId);

                // Run local QT dict translation for Title
                let dictTranslatedTitle = "";
                const titleRes = await convertText(chapter.title, {
                    novelNames: nameDict,
                    options: { activeDictSources: qtDictSources },
                });
                dictTranslatedTitle = titleRes.plainText;

                // Cut into chunks for AI
                const chunks = chunkText(cleanedContent, 1600);
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
                        novelCustomPrompt,
                        novel?.stylePreset,
                        novel?.pronounMatrix,
                        novel?.pronounMatrixEnabled
                    );

                    // Relevant name injection
                    let relevantNamesPrompt = "";
                    const relevantNames = nameDict.filter((n) =>
                        chunk.includes(n.chinese) &&
                        ["nhân vật", "địa danh", "môn phái", "bang hội", "tên riêng", "thuật ngữ", "context mapping", "khác", "tuvung", "ngucanh"].includes(n.category)
                    ).sort((a, b) => b.chinese.length - a.chinese.length);

                    if (relevantNames.length > 0) {
                        relevantNamesPrompt = `\n\n# Bảng tên riêng bắt buộc dùng đúng:\n`;
                        for (const n of relevantNames.slice(0, 150)) {
                            relevantNamesPrompt += `${n.chinese} → ${n.vietnamese}\n`;
                        }
                    }

                    const draftUser = buildDraftUserPrompt(chunk, chunkDictTranslated, novelCustomPrompt) + relevantNamesPrompt;

                    let rawDraftOutput = "";
                    let draftSuccess = false;
                    let lastDraftError = null;

                    for (let attempt = 0; attempt <= MAX_PERSISTENT_ATTEMPTS; attempt++) {
                        if (signal?.aborted) throw new Error("Aborted");
                        try {
                            const res = await streamText({
                                model,
                                system: draftSystem,
                                prompt: draftUser,
                                abortSignal: signal,
                                maxOutputTokens: 10000,
                            });

                            let text = "";
                            for await (const t of res.textStream) {
                                text += t;
                            }
                            rawDraftOutput = text;
                            draftSuccess = true;
                            break;
                        } catch (err) {
                            lastDraftError = err;
                            await new Promise((r) => setTimeout(r, PERSISTENT_RETRY_DELAY));
                        }
                    }

                    if (!draftSuccess || !rawDraftOutput.trim()) {
                        throw lastDraftError || new Error(`Không dịch được bản nháp tại đoạn ${chunkIdx + 1}`);
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
                        throw new Error(`AI dịch nháp trả về nội dung trống ở đoạn ${chunkIdx + 1}`);
                    }
                    let finalChunkContent = parsedDraft.content;

                    // Run Phase 2 (Optional Polish / Editorial Pass)
                    if (twoPass) {
                        const editSystem = getEditorSystemPrompt(
                            genreText,
                            genreGuidelines,
                            novelCustomPrompt,
                            novel?.stylePreset,
                            novel?.pronounMatrix,
                            novel?.pronounMatrixEnabled
                        );

                        const editUser = buildEditorUserPrompt(chunk, finalChunkContent, novelCustomPrompt);

                        let editSuccess = false;
                        let lastEditError = null;
                        let rawEditOutput = "";

                        for (let attempt = 0; attempt <= MAX_PERSISTENT_ATTEMPTS; attempt++) {
                            if (signal?.aborted) throw new Error("Aborted");
                            try {
                                const res = await streamText({
                                    model,
                                    system: editSystem,
                                    prompt: editUser,
                                    abortSignal: signal,
                                    maxOutputTokens: 10000,
                                });
                                let text = "";
                                for await (const t of res.textStream) {
                                    text += t;
                                }
                                rawEditOutput = text;
                                editSuccess = true;
                                break;
                            } catch (err) {
                                lastEditError = err;
                                await new Promise((r) => setTimeout(r, PERSISTENT_RETRY_DELAY));
                            }
                        }

                        if (!editSuccess || !rawEditOutput.trim()) {
                            throw lastEditError || new Error(`Không dịch được bản biên tập tại đoạn ${chunkIdx + 1}`);
                        }

                        const parsedEdit = parseIntermediateResult(rawEditOutput);
                        if (!parsedEdit.content?.trim()) {
                            throw new Error(`AI biên tập trả về nội dung trống ở đoạn ${chunkIdx + 1}`);
                        }
                        finalChunkContent = parsedEdit.content;
                    }

                    finalAccumulatedContent += (finalAccumulatedContent ? "\n\n" : "") + finalChunkContent;
                } // end of chunks loop

                // Map content back to scenes
                let finalParsedScenes = [];
                if (isMultiScene) {
                    const parts = finalAccumulatedContent.split(SCENE_BREAK).map((s) => s.trim());
                    finalParsedScenes = chapterScenes.map((s, i) => ({
                        sceneId: s.id,
                        content: parts[i] || s.content,
                    }));
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
                        wordCount: countWords(scene.content),
                        updatedAt: now,
                    });
                }

                onChapterComplete({
                    chapterId: chapter.id,
                    chapterTitle: chapter.title,
                    originalTitle: chapter.title,
                    newTitle: finalParsedTitle ?? chapter.title,
                    scenes: finalParsedScenes,
                    extractedNamesCount: totalExtractedNamesCount,
                });

                store.setChapterStatus(novelId, chapter.id, "done");
                store.addResult(novelId, {
                    chapterId: chapter.id,
                    chapterTitle: chapter.title,
                    originalTitle: chapter.title,
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
