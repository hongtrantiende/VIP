/**
 * Scan & Fix Translate Engine
 * 
 * Quét bản dịch hiện có → AI tìm và sửa lỗi tên nhân vật, ngữ pháp, chính tả.
 * Tự động sửa luôn không cần xác nhận.
 */
import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db, GENRE_LABELS } from "@/lib/db";
import { createSceneVersion, ensureInitialVersion, getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { getMergedNameDict } from "@/lib/hooks/use-name-entries";
import { useBulkTranslateStore } from "@/lib/stores/bulk-translate";
import { chunkText } from "@/lib/text-utils";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY = 5000;

function getScanFixSystemPrompt(
    genreText: string,
    novelCustomPrompt?: string,
    nameListStr?: string,
) {
    return `# Vai trò
Bạn là chuyên gia kiểm duyệt và sửa lỗi bản dịch tiểu thuyết Trung-Việt.
Nhiệm vụ: Đọc bản dịch Tiếng Việt, phát hiện và SỬA tất cả các lỗi sau:

# Thể loại: ${genreText}

# Các loại lỗi cần quét và sửa:
1. **Lỗi tên nhân vật**: Tên viết sai dấu, sai chính tả, viết không nhất quán (VD: "Trần Pham" → "Trần Phàm")
2. **Lỗi xưng hô**: Xưng hô không phù hợp bối cảnh/thể loại
3. **Lỗi ngữ pháp**: Câu lủng củng, thiếu chủ ngữ, sai cấu trúc
4. **Lỗi chính tả**: Sai dấu tiếng Việt, lỗi đánh máy
5. **Từ dịch thô**: Các cụm Hán Việt thô cứng cần chuyển thành diễn đạt tự nhiên
6. **Câu vô nghĩa**: Các đoạn dịch máy không có nghĩa cần viết lại

# Quy tắc:
- PHẢI giữ nguyên nội dung cốt truyện, KHÔNG thêm bớt tình tiết
- BẮT BUỘC biên tập đầy đủ 100% nội dung, TUYỆT ĐỐI không tóm tắt, cắt xén hay lược bỏ câu chữ.
- PHẢI giữ nguyên cấu trúc đoạn văn, số dòng. Nếu có dấu phân cách phân cảnh (như ===SCENE_BREAK===), bắt buộc giữ nguyên định dạng và vị trí của các dấu này, không tự ý xóa bỏ hay sửa đổi.
- Chỉ SỬA những chỗ thực sự có lỗi, không viết lại toàn bộ
- Tên nhân vật PHẢI khớp với Bảng tên chính thức (nếu có)
${nameListStr ? `\n# Bảng tên chính thức (BẮT BUỘC dùng đúng):\n${nameListStr}` : ""}

# Định dạng đầu ra:
<fixes>
(Danh sách ngắn gọn các lỗi đã sửa, mỗi dòng 1 lỗi: "Sai → Đúng")
</fixes>
<content>
(Bản dịch đã sửa lỗi hoàn chỉnh - TIẾNG VIỆT)
</content>
` + (novelCustomPrompt?.trim() ? `\n\n# Quy tắc riêng (ƯU TIÊN TUYỆT ĐỐI):\n${novelCustomPrompt.trim()}` : "");
}

function parseResult(xml: string): { fixes: string[]; content: string } {
    const fixes: string[] = [];

    const fixesMatch = xml.match(/<fixes>([\s\S]*?)<\/fixes>/);
    if (fixesMatch?.[1]) {
        for (const line of fixesMatch[1].split("\n")) {
            const trimmed = line.trim();
            if (trimmed && trimmed.includes("→")) fixes.push(trimmed);
        }
    }

    const contentMatch = xml.match(/<content>([\s\S]*?)<\/content>/);
    const content = contentMatch?.[1]?.trim() || xml.replace(/<fixes>[\s\S]*?<\/fixes>/, "").replace(/<\/?content>/g, "").trim();

    return { fixes, content };
}

function countWords(s: string) {
    return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

export interface ScanFixResult {
    chapterId: string;
    chapterTitle: string;
    scenes: { sceneId: string; content: string }[];
    fixesCount: number;
    fixes: string[];
}

export interface ScanFixOptions {
    novelId: string;
    chapterIds: string[];
    model: LanguageModel;
    novelCustomPrompt?: string;
    signal?: AbortSignal;
    delayMs?: number;
    chunkMode?: "chunk" | "full";
    onPhase?: (chapterId: string, phase: string) => void;
    onChapterStart?: (chapterId: string, title: string) => void;
    onChapterComplete?: (res: ScanFixResult) => void;
    onChapterError?: (err: { chapterId: string; chapterTitle: string; message: string }) => void;
    onAllComplete?: () => void;
}

export async function runScanFix(opts: ScanFixOptions) {
    const {
        novelId,
        chapterIds,
        model,
        novelCustomPrompt,
        chunkMode,
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

    // Build name reference list
    const nameDict = await getMergedNameDict(novelId);
    let nameListStr = "";
    if (nameDict.length > 0) {
        nameListStr = nameDict
            .filter(n => ["nhân vật", "địa danh", "môn phái", "tên riêng"].includes(n.category))
            .slice(0, 200)
            .map(n => `${n.chinese} → ${n.vietnamese}`)
            .join("\n");
    }

    const systemPrompt = getScanFixSystemPrompt(genreText, novelCustomPrompt, nameListStr || undefined);

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
            const allFixes: string[] = [];

            for (const scene of chapterScenes) {
                if (signal?.aborted) throw new Error("Aborted");

                const currentContent = scene.content;
                if (!currentContent?.trim()) continue;

                const origContent = await getOriginalContent(scene.id);

                // Inject relevant names for this scene
                const relevantNames = nameDict
                    .filter(n => (origContent && origContent.includes(n.chinese)) || currentContent.includes(n.vietnamese))
                    .slice(0, 100);

                let sceneNameHint = "";
                if (relevantNames.length > 0) {
                    sceneNameHint = `\n\nTên riêng liên quan đến đoạn này:\n` +
                        relevantNames.map(n => `${n.chinese} → ${n.vietnamese}`).join("\n");
                }

                const chunkSize = chunkMode === "full" ? 20000 : 2000;
                const chunks = chunkText(currentContent, chunkSize);
                let fixedContent = "";

                for (const chunk of chunks) {
                    if (signal?.aborted) throw new Error("Aborted");

                    let success = false;
                    let lastErr: any = null;

                    for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt++) {
                        try {
                            const res = await streamText({
                                model,
                                system: systemPrompt,
                                prompt: `[BẢN DỊCH CẦN QUÉT LỖI]\n${chunk}${sceneNameHint}\n\nHãy quét tất cả lỗi trong đoạn trên, sửa và trả về kết quả.`,
                                abortSignal: signal,
                                maxOutputTokens: 10000,
                            });
                            let text = "";
                            for await (const t of res.textStream) { text += t; }

                            // Streaming fallback
                            if (!text.trim()) {
                                console.warn(`[AI ScanFix] Stream returned empty. Retrying with generateText...`);
                                const { generateText } = await import("ai");
                                const directRes = await generateText({
                                    model,
                                    system: systemPrompt,
                                    prompt: `[BẢN DỊCH CẦN QUÉT LỖI]\n${chunk}${sceneNameHint}\n\nHãy quét tất cả lỗi trong đoạn trên, sửa và trả về kết quả.`,
                                    abortSignal: signal,
                                });
                                text = directRes.text;
                            }

                            const parsed = parseResult(text);
                            if (parsed.content.trim()) {
                                fixedContent += (fixedContent ? "\n\n" : "") + parsed.content;
                                allFixes.push(...parsed.fixes);
                                success = true;
                                break;
                            }
                        } catch (err: any) {
                            if (signal?.aborted || err?.name === "AbortError") throw err;
                            lastErr = err;
                            await new Promise(r => setTimeout(r, RETRY_DELAY));
                        }
                    }

                    if (!success) throw lastErr || new Error("AI quét lỗi trả về rỗng");
                }

                // Save
                await ensureInitialVersion(scene.id, novelId, origContent);
                await createSceneVersion(scene.id, novelId, "scan-fix", fixedContent);
                await db.scenes.update(scene.id, {
                    content: fixedContent,
                    versionType: "scan-fix",
                    wordCount: countWords(fixedContent),
                    updatedAt: new Date(),
                });

                finalScenes.push({ sceneId: scene.id, content: fixedContent });
            }

            onPhase(chapter.id, "done");
            onChapterComplete({
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                scenes: finalScenes,
                fixesCount: allFixes.length,
                fixes: allFixes,
            });
            store.setChapterStatus(novelId, chapter.id, "done");
            store.incrementCompleted(novelId);
        } catch (err: any) {
            if (err.name === "AbortError" || signal?.aborted) break;
            const msg = err instanceof Error ? err.message : "Quét lỗi thất bại";
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
