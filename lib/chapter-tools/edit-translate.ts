/**
 * Edit Translate Engine
 * 
 * Biên tập AI: Lấy bản dịch đã có → AI biên tập/làm mịn văn phong theo prompt.
 * Không dịch lại — chỉ polish bản dịch hiện tại.
 */
import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db, GENRE_LABELS } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { chunkText } from "@/lib/text-utils";
import { getMergedNameDict } from "@/lib/hooks/use-name-entries";
import { parseQaAndApply } from "./qa-helper";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY = 5000;

function getEditSystemPrompt(
    genreText: string,
    genreGuidelines: string,
    novelCustomPrompt?: string,
    stylePreset?: string,
    customStylePrompt?: string,
    customPronounPrompt?: string,
) {
    let styleInstruction = "";
    if (stylePreset === "epic") {
        styleInstruction = `\n- **Phong cách (Hùng tráng)**: Hành văn dồn dập, hào hùng, kịch tính. Ưu tiên động từ mạnh mẽ.`;
    } else if (stylePreset === "poetic") {
        styleInstruction = `\n- **Phong cách (Cổ phong)**: Hành văn mềm mại, cổ kính, giàu tính nhạc họa. Ưu tiên từ Hán Việt mỹ lệ.`;
    } else if (stylePreset === "modern") {
        styleInstruction = `\n- **Phong cách (Hiện đại)**: Hành văn tự nhiên, bình dị, thuần Việt hiện đại. Câu cú gãy gọn dễ hiểu.`;
    } else if (stylePreset === "romantic") {
        styleInstruction = `\n- **Phong cách (Tình cảm)**: Hành văn lãng mạn, giàu cảm xúc, chú trọng mô tả nội tâm.`;
    }

    let customInstructions = "";
    if (novelCustomPrompt?.trim()) {
        customInstructions += `\n\n# CHỈ DẪN PROMPT BIÊN TẬP (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI):\n${novelCustomPrompt.trim()}`;
    }
    if (customStylePrompt?.trim()) {
        customInstructions += `\n\n# CHỈ DẪN VỀ VĂN PHONG DỊCH (BẮT BUỘC): \n${customStylePrompt.trim()}`;
    }
    if (customPronounPrompt?.trim()) {
        customInstructions += `\n\n# QUY TẮC XƯNG HÔ & BỐI CẢNH (BẮT BUỘC): \n${customPronounPrompt.trim()}`;
    }

    return `# Vai trò
Bạn là tổng biên tập văn học kì cựu chuyên biên tập tiểu thuyết dịch tại Việt Nam.
Nhiệm vụ: Đọc bản dịch Tiếng Việt dưới đây và biên tập lại cho văn phong trôi chảy, tự nhiên, giàu cảm xúc văn học.

# Thể loại: ${genreText}${styleInstruction}
${genreGuidelines}

# Chỉ dẫn biên tập:
1. **Xóa phong cách thô cứng**: Chuyển các cụm từ Hán Việt thô thành diễn đạt tự nhiên thuần Việt.
2. **Nhịp điệu câu**: Điều chỉnh độ dài ngắn câu tạo sự nhịp nhàng, truyền cảm.
3. **Nhất quán tên riêng**: Giữ nguyên tên nhân vật, địa danh chính xác tuyệt đối.
4. **Không sáng tác thêm & Bản dịch đầy đủ 100% (Tuyệt đối không tóm tắt)**: Không thêm bớt tình tiết ngoại truyện. BẮT BUỘC biên tập đầy đủ 100% nội dung, không tóm tắt ý, không cắt xén hay lược bỏ bất kỳ câu chữ nào.
5. **Giữ cấu trúc và dấu phân cảnh**: Giữ nguyên số đoạn văn, dấu ngắt dòng. Nếu có dấu phân cách phân cảnh (như ===SCENE_BREAK===), bạn BẮT BUỘC phải giữ nguyên chính xác định dạng và vị trí của các dấu này, không tự ý xóa bỏ hay dịch nghĩa.

# Định dạng đầu ra:
<content>
(Bản dịch đã biên tập hoàn thiện - TIẾNG VIỆT)
</content>
` + customInstructions;
}

function getEditQaSystemPrompt(
    genreText: string,
    nameDict: any[],
    chineseText?: string,
    customQaPrompt?: string,
    customPronounPrompt?: string
) {
    const relevantNames = nameDict
        .filter(
            (n) =>
                (!chineseText || chineseText.includes(n.chinese)) &&
                [
                    "nhân vật",
                    "names",
                    "địa danh",
                    "môn phái",
                    "bang hội",
                    "tên riêng",
                    "thuật ngữ",
                    "context mapping",
                    "khác",
                    "tuvung",
                    "ngucanh",
                    "vật phẩm",
                    "kỹ năng",
                    "thuật ngữ tu tiên",
                ].includes(n.category)
        )
        .sort((a, b) => b.chinese.length - a.chinese.length);

    let relevantNamesPrompt = "";
    if (relevantNames.length > 0) {
        relevantNamesPrompt = `\n\n# Bảng tên riêng bắt buộc dùng đúng:\n`;
        for (const n of relevantNames.slice(0, 150)) {
            relevantNamesPrompt += `${n.chinese} hoặc phiên âm tương tự → ${n.vietnamese}\n`;
        }
    }

    const pronounRules = nameDict.filter((n) => n.category === "xưng hô");
    let relevantPronounsPrompt = "";
    for (const p of pronounRules) {
        const cnKey = p.chinese; // Định dạng "林枫->楚瑶"
        const [speakerCn, listenerCn] = cnKey.split("->").map((s: string) => s.trim());
        const hasChineseMatch = !chineseText || (speakerCn && listenerCn && chineseText.includes(speakerCn) && chineseText.includes(listenerCn));
        if (hasChineseMatch) {
            const parts = p.vietnamese.split("|");
            const pronPart = parts[0];
            const namePart = parts[1] || "";
            const [speakerPron, listenerPron] = pronPart.split("->").map((s: string) => s.trim());
            const [speakerName, listenerName] = namePart.split("->").map((s: string) => s.trim());

            if (speakerName && listenerName && speakerPron && listenerPron) {
                if (!relevantPronounsPrompt) {
                    relevantPronounsPrompt = `\n\n# Quy tắc xưng hô nhân vật bắt buộc tuân thủ (Chỉ trích xuất các nhân vật có mặt trong chương):\n`;
                }
                relevantPronounsPrompt += `- ${speakerName} nói với ${listenerName}: ${speakerName} xưng "${speakerPron}", gọi ${listenerName} là "${listenerPron}"\n`;
            }
        }
    }

    let pronounPrompt = "";
    if (relevantPronounsPrompt) {
        pronounPrompt = relevantPronounsPrompt;
        if (customPronounPrompt?.trim()) {
            pronounPrompt += `\n# Quy tắc xưng hô & Bối cảnh bổ sung:\n${customPronounPrompt.trim()}\n`;
        }
    } else if (customPronounPrompt?.trim()) {
        pronounPrompt = `\n\n# Quy tắc xưng hô & Bối cảnh bắt buộc tuân thủ:\n${customPronounPrompt.trim()}\n`;
    }

    if (customQaPrompt?.trim()) {
        return `${customQaPrompt.trim()}${relevantNamesPrompt}${pronounPrompt}`;
    }

    return `# Vai trò
Bạn là Giám sát Chất lượng Biên tập Văn học (QA Bot) chuyên nghiệp. Nhiệm vụ của bạn là rà soát và tinh chỉnh bản dịch tiếng Việt đã biên tập ở bước 1 để nâng cao độ trôi chảy, tự nhiên và đặc biệt sửa các lỗi không nhất quán về tên riêng, đại từ xưng hô và lỗi chính tả/ngữ pháp.
${relevantNamesPrompt}${pronounPrompt}
# Quy tắc sửa lỗi (BẮT BUỘC):
1. **Kiểm tra và sửa đổi tên riêng**:
   - Đối chiếu tên nhân vật trong văn bản dịch chưa tinh chỉnh với Bảng tên riêng.
   - Nếu xuất hiện tên bị viết sai hoặc không đồng bộ (ví dụ: "Lâm Phong" bị viết nhầm thành "Lâm Phóng", v.v.), bạn BẮT BUỘC phải sửa lại câu văn đó cho đúng tên dịch chuẩn.
2. **Đồng bộ hóa đại từ nhân xưng và cách xưng hô**:
   - Đối chiếu quy tắc xưng hô trong phần "Quy tắc xưng hô & Bối cảnh bắt buộc tuân thủ" (nếu có).
   - Đảm bảo cách xưng hô giữa hai nhân vật phải nhất quán xuyên suốt chương truyện. Tránh tình trạng loạn xưng hô (ví dụ: đoạn đầu gọi "cô" xưng "tôi", đoạn sau lại đổi thành "em" xưng "anh" mà không có lý do hợp lý hoặc không có sự thay đổi về quan hệ/bối cảnh hội thoại). Nếu phát hiện xưng hô bị loạn hoặc sai quy tắc, hãy sửa các câu văn đó để đồng bộ nhất quán.
3. **Hành văn & Chính tả**:
   - Tinh chỉnh các câu từ thô cứng, lặp từ hoặc diễn đạt chưa mượt mà để câu văn tự nhiên chuẩn văn học Việt Nam theo thể loại: ${genreText}.
4. **Định dạng câu trả lời tiết kiệm Token**:
   - Bạn chỉ cần trả về các dòng có lỗi cần sửa đổi kèm theo số dòng tương ứng.
   - Tuyệt đối KHÔNG viết lại toàn bộ văn bản hay các câu không có lỗi, KHÔNG chèn thêm nhận xét, giải thích.
   - Định dạng đầu ra bắt buộc cho mỗi dòng sửa đổi: \`L[Số dòng]: [Nội dung câu đã sửa lại hoàn chỉnh]\`
   - Nếu toàn bộ văn bản hoàn toàn chính xác và không có dòng nào cần sửa đổi, hãy trả về duy nhất chuỗi sau: "Không có lỗi"`;
}

function buildEditQaUserPrompt(finalChunkContent: string): string {
    const draftLines = finalChunkContent.split(/\r?\n/);
    const formattedDraftLines = draftLines
        .map((line, index) => `L${index + 1}: ${line}`)
        .join("\n");

    return `[VĂN BẢN TIẾNG VIỆT CHƯA TINH CHỈNH VỚI SỐ DÒNG]
${formattedDraftLines}

Hãy rà soát và chỉ trả về các câu có lỗi đã được sửa lại theo định dạng \`L[Số dòng]: [Nội dung câu đã sửa]\`:`;
}

function parseContent(xml: string): string {
    const match = xml.match(/<content>([\s\S]*?)<\/content>/);
    if (match?.[1]) return match[1].trim();
    return xml.replace(/<\/?content>/g, "").trim();
}

export interface EditTranslateResult {
    chapterId: string;
    chapterTitle: string;
    scenes: { sceneId: string; content: string }[];
}

export interface EditTranslateOptions {
    novelId: string;
    chapterIds: string[];
    model: LanguageModel;
    novelCustomPrompt?: string;
    customStylePrompt?: string;
    customPronounPrompt?: string;
    twoPass?: boolean;
    qaModel?: LanguageModel;
    qaEnabled?: boolean;
    qaPrompt?: string;
    skipTranslated?: boolean;
    errorAction?: "stop" | "skip";
    signal?: AbortSignal;
    delayMs?: number;
    onPhase?: (chapterId: string, phase: string) => void;
    onChapterStart?: (chapterId: string, title: string) => void;
    onChapterComplete?: (res: EditTranslateResult) => void;
    onChapterError?: (err: { chapterId: string; chapterTitle: string; message: string }) => void;
    onAllComplete?: () => void;
}

export async function runEditTranslate(opts: EditTranslateOptions) {
    const {
        novelId,
        chapterIds,
        model,
        novelCustomPrompt,
        customStylePrompt,
        customPronounPrompt,
        twoPass = true,
        qaModel,
        qaEnabled = false,
        qaPrompt,
        skipTranslated = true,
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
    const genreKeys = novel?.genres || (novel?.genre ? [novel.genre] : []);
    const genreText = genreKeys.map(k => GENRE_LABELS[k] || k).join(", ") || "Chưa xác định";

    // Build context-specific guidelines based on novel genre
    let genreGuidelines = "";
    if (genreKeys.some(k => ["tienhiep", "huyenhuyen", "dongphuong", "quybi"].includes(k))) {
        genreGuidelines = `
        - **Đặc trưng Thể loại (Tiên hiệp/Kỳ huyễn/Huyền huyễn)**: Tông giọng cổ kính, tôn nghiêm, sử dụng từ ngữ Hán Việt văn học cổ phong hợp lý. 
        - **Quy tắc xưng hô**: Ưu tiên cổ phong trang nghiêm (Ta - Ngươi, Huynh - Đệ, Sư tôn - Đồ đệ, Bổn tọa, Các hạ, Tiền bối - Vãn bối).`;
    } else if (genreKeys.some(k => ["dothi", "hiendai", "school", "hocduong", "vongdu"].includes(k))) {
        genreGuidelines = `
        - **Đặc trưng Thể loại (Hiện đại/Đô thị/Võng du)**: Hành văn hiện đại, trẻ trung, đời thường, trôi chảy tự nhiên.
        - **Quy tắc xưng hô**: Linh hoạt theo bối cảnh xã hội hiện đại (Tôi - Cậu, Anh - Em, Ta - Ngươi khi thù địch/khiêu khích, Hắn, Nàng, Gã).`;
    } else if (genreKeys.some(k => ["ngontinh", "dammi"].includes(k))) {
        genreGuidelines = `
        - **Đặc trưng Thể loại (Ngôn tình/Đam mỹ)**: Văn phong giàu cảm xúc, lãng mạn, mượt mà, tập trung sâu mô tả nội tâm và đường nét cử chỉ.
        - **Quy tắc xưng hô**: Phải sâu lắng và tình cảm (Ta - Chàng/Thiếp nếu cổ đại; Anh - Em, Tôi - Em nếu hiện đại).`;
    }

    const nameDict = await getMergedNameDict(novelId);
    const systemPrompt = getEditSystemPrompt(genreText, genreGuidelines, novelCustomPrompt, novel?.stylePreset, customStylePrompt, customPronounPrompt);

    for (const chapterId of chapterIds) {
        if (signal?.aborted) break;

        const chapter = await db.chapters.get(chapterId);
        if (!chapter) continue;

        onChapterStart(chapter.id, chapter.title);
        store.setChapterStatus(novelId, chapter.id, "translating");

        try {
            const scenes = await db.scenes
                .where("[novelId+isActive]")
                .equals([novelId, 1])
                .toArray();

            const chapterScenes = scenes
                .filter(s => s.chapterId === chapter.id)
                .sort((a, b) => a.order - b.order);

            if (chapterScenes.length === 0) {
                throw new Error("Không tìm thấy phân cảnh nào.");
            }

            // skip check
            if (skipTranslated && chapterScenes.every(s => s.versionType === "edit-translate" || s.versionType === "ai-translate")) {
                store.setChapterStatus(novelId, chapter.id, "done");
                store.incrementCompleted(novelId);
                continue;
            }

            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));

            onPhase(chapter.id, "ai");

            const finalScenes: { sceneId: string; content: string }[] = [];

            for (const scene of chapterScenes) {
                if (signal?.aborted) throw new Error("Aborted");

                const currentContent = scene.content;
                if (!currentContent?.trim()) continue;

                const origContent = await getOriginalContent(scene.id).catch(() => "");

                const chunks = chunkText(currentContent, 2000);
                let editedContent = "";

                for (const chunk of chunks) {
                    if (signal?.aborted) throw new Error("Aborted");

                    let success = false;
                    let lastErr: any = null;
                    let chunkOutput = "";

                    // Pass 1: Main Edit rewrite
                    for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt++) {
                        try {
                            const res = await streamText({
                                model,
                                system: systemPrompt,
                                prompt: `[BẢN DỊCH CẦN BIÊN TẬP]\n${chunk}\n\nHãy biên tập lại bản dịch trên cho văn phong trôi chảy, tự nhiên nhất.`,
                                abortSignal: signal,
                                maxOutputTokens: 10000,
                            });
                            let text = "";
                            for await (const t of res.textStream) { text += t; }

                            if (!text.trim()) {
                                const { generateText } = await import("ai");
                                const directRes = await generateText({
                                    model,
                                    system: systemPrompt,
                                    prompt: `[BẢN DỊCH CẦN BIÊN TẬP]\n${chunk}\n\nHãy biên tập lại bản dịch trên cho văn phong trôi chảy, tự nhiên nhất.`,
                                    abortSignal: signal,
                                });
                                text = directRes.text;
                            }

                            const parsed = parseContent(text);
                            if (parsed.trim()) {
                                chunkOutput = parsed;
                                success = true;
                                break;
                            }
                        } catch (err: any) {
                            if (signal?.aborted || err?.name === "AbortError") throw err;
                            lastErr = err;
                            await new Promise(r => setTimeout(r, RETRY_DELAY));
                        }
                    }

                    if (!success || !chunkOutput.trim()) {
                        throw lastErr || new Error("AI biên tập trả về rỗng");
                    }

                    // Pass 2: QA Polisher
                    if (qaEnabled && qaModel) {
                        onPhase(chapter.id, "model3");
                        const latestNovel = await db.novels.get(novelId);
                        const qaSystem = getEditQaSystemPrompt(genreText, nameDict, origContent, qaPrompt, latestNovel?.customPronounPrompt);
                        const qaUser = buildEditQaUserPrompt(chunkOutput);

                        let qaResult = "";
                        let qaSuccess = false;
                        for (let qaAttempt = 0; qaAttempt < 2; qaAttempt++) {
                            try {
                                const { generateText } = await import("ai");
                                const res = await generateText({
                                    model: qaModel,
                                    system: qaSystem,
                                    prompt: qaUser,
                                    abortSignal: signal,
                                });
                                qaResult = res.text ?? "";
                                qaSuccess = true;
                                if (qaResult.trim()) break;
                            } catch (err) {
                                await new Promise((r) => setTimeout(r, 1000));
                            }
                        }

                        if (qaSuccess && qaResult.trim() && qaResult !== "Không có lỗi") {
                            chunkOutput = parseQaAndApply(qaResult, chunkOutput);
                        }
                    }

                    editedContent += (editedContent ? "\n\n" : "") + chunkOutput;
                }

                // Save
                await ensureInitialVersion(scene.id, novelId, origContent);
                await createSceneVersion(scene.id, novelId, "edit-translate", editedContent);
                await db.scenes.update(scene.id, {
                    content: editedContent,
                    versionType: "edit-translate",
                    wordCount: editedContent.split(/\s+/).filter(Boolean).length,
                    updatedAt: new Date(),
                });

                finalScenes.push({ sceneId: scene.id, content: editedContent });
            }

            onPhase(chapter.id, "done");
            onChapterComplete({ chapterId: chapter.id, chapterTitle: chapter.title, scenes: finalScenes });
            store.setChapterStatus(novelId, chapter.id, "done");
            store.incrementCompleted(novelId);
        } catch (err: any) {
            if (err.name === "AbortError" || signal?.aborted) break;
            const msg = err instanceof Error ? err.message : "Biên tập thất bại";
            onChapterError({ chapterId: chapter.id, chapterTitle: chapter.title, message: msg });
            store.setChapterStatus(novelId, chapter.id, "error");
            store.incrementCompleted(novelId);

            if (errorAction === "stop") {
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
