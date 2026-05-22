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

const MAX_ATTEMPTS = 3;
const RETRY_DELAY = 5000;

function getEditSystemPrompt(
    genreText: string,
    novelCustomPrompt?: string,
    stylePreset?: string,
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

    return `# Vai trò
Bạn là tổng biên tập văn học kì cựu chuyên biên tập tiểu thuyết dịch tại Việt Nam.
Nhiệm vụ: Đọc bản dịch Tiếng Việt dưới đây và biên tập lại cho văn phong trôi chảy, tự nhiên, giàu cảm xúc văn học.

# Thể loại: ${genreText}${styleInstruction}

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
` + (novelCustomPrompt?.trim() ? `\n\n# Quy tắc riêng (ƯU TIÊN TUYỆT ĐỐI):\n${novelCustomPrompt.trim()}` : "");
}

function parseContent(xml: string): string {
    const match = xml.match(/<content>([\s\S]*?)<\/content>/);
    if (match?.[1]) return match[1].trim();
    return xml.replace(/<\/?content>/g, "").trim();
}

function countWords(s: string) {
    return s ? s.split(/\s+/).filter(Boolean).length : 0;
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
    skipTranslated?: boolean;
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

    const systemPrompt = getEditSystemPrompt(genreText, novelCustomPrompt, novel?.stylePreset);

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

            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));

            onPhase(chapter.id, "ai");

            const finalScenes: { sceneId: string; content: string }[] = [];

            for (const scene of chapterScenes) {
                if (signal?.aborted) throw new Error("Aborted");

                // Get current translated content (not original)
                const currentContent = scene.content;
                if (!currentContent?.trim()) continue;

                const chunks = chunkText(currentContent, 2000);
                let editedContent = "";

                for (const chunk of chunks) {
                    if (signal?.aborted) throw new Error("Aborted");

                    let success = false;
                    let lastErr: any = null;

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

                            // Streaming fallback
                            if (!text.trim()) {
                                console.warn(`[AI Edit] Stream returned empty. Retrying with generateText...`);
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
                                editedContent += (editedContent ? "\n\n" : "") + parsed;
                                success = true;
                                break;
                            }
                        } catch (err: any) {
                            if (signal?.aborted || err?.name === "AbortError") throw err;
                            lastErr = err;
                            await new Promise(r => setTimeout(r, RETRY_DELAY));
                        }
                    }

                    if (!success) throw lastErr || new Error("AI biên tập trả về rỗng");
                }

                // Save
                const origContent = await getOriginalContent(scene.id);
                await ensureInitialVersion(scene.id, novelId, origContent);
                await createSceneVersion(scene.id, novelId, "edit-translate", editedContent);
                await db.scenes.update(scene.id, {
                    content: editedContent,
                    versionType: "edit-translate",
                    wordCount: countWords(editedContent),
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

            // Stop the entire translation job immediately upon chapter failure
            store.cancel(novelId);
            break;
        }
    }

    if (signal?.aborted) {
        store.cancel(novelId);
    } else {
        store.finish(novelId);
        onAllComplete();
    }
}
