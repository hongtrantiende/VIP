/**
 * Scan first N chapters to detect genre, style, and translation rules.
 * Simple & focused: only genre + style + banned words. No name extraction.
 */
import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { db } from "@/lib/db";
import type { Scene } from "@/lib/db";
import { getOriginalContent } from "@/lib/hooks/use-scene-versions";

const SCAN_CHAPTER_COUNT = 10;
const MAX_CHARS_PER_CHAPTER = 1000;

async function collectSampleText(novelId: string): Promise<{
  sampleText: string;
  chapterCount: number;
}> {
  const chapters = await db.chapters
    .where("novelId")
    .equals(novelId)
    .sortBy("order");

  const firstChapters = chapters.slice(0, SCAN_CHAPTER_COUNT);
  if (firstChapters.length === 0) {
    throw new Error("Truyện chưa có chương nào.");
  }

  const chapterIds = new Set(firstChapters.map((c) => c.id));
  const allScenes = await db.scenes
    .where("[novelId+isActive]")
    .equals([novelId, 1])
    .toArray();

  const scenesByChapter = new Map<string, Scene[]>();
  for (const s of allScenes) {
    if (!chapterIds.has(s.chapterId)) continue;
    const arr = scenesByChapter.get(s.chapterId) ?? [];
    arr.push(s);
    scenesByChapter.set(s.chapterId, arr);
  }
  for (const scenes of scenesByChapter.values()) {
    scenes.sort((a, b) => a.order - b.order);
  }

  const parts: string[] = [];
  for (const chapter of firstChapters) {
    const scenes = scenesByChapter.get(chapter.id) ?? [];
    if (scenes.length === 0) continue;
    const contents = await Promise.all(scenes.map((s) => getOriginalContent(s.id)));
    const content = contents.join("\n\n");
    if (!content.trim()) continue;
    parts.push(content.slice(0, MAX_CHARS_PER_CHAPTER));
  }

  return { sampleText: parts.join("\n---\n"), chapterCount: parts.length };
}

const SCAN_SYSTEM_PROMPT = `Đọc đoạn trích tiểu thuyết Trung Quốc. Trả về NGẮN GỌN, không giải thích:

---BEGIN---
Thể loại: [có thể kết hợp nhiều, ví dụ: Tiên hiệp, Xuyên không / Đô thị, Trọng sinh / Huyền huyễn, Hệ thống. Các thể loại: Tiên hiệp, Huyền huyễn, Đô thị, Ngôn tình, Võ hiệp, Khoa huyễn, Đồng nhân, Kinh dị, Lịch sử, Xuyên không, Xuyên việt, Trọng sinh, Hệ thống, Mạt thế, Quân sự, Game, Thể thao, Đam mỹ, Bách hợp, Tu chân, Cung đấu, Trạch đấu, Dị năng, Linh dị, Hài hước]
Lưu phái: [Nhiệt huyết / Nhẹ nhàng / Hắc ám / Trí tuệ / Vô địch lưu / Phế sài lưu / Chuyển thế lưu / Hệ thống lưu / Kiến thiết lưu / Hài hước / Sảng văn / Chính kịch / Cung đình lưu / Nữ cường / Nam cường]
Bối cảnh: [Cổ đại / Hiện đại / Dị giới / Tiên giới / Mạt thế / Hỗn hợp]
Phong cách: [Cổ phong trang nghiêm / Hiện đại nhẹ nhàng / U ám lạnh lùng / Hài hước / Sử thi hùng tráng / Lãng mạn / Kịch tính / Nhiệt huyết sôi động]
Xưng hô: [ta/ngươi, bản tọa, tại hạ / tôi/anh/cậu / pha trộn]
Tone dịch: [Cổ kính trang trọng / Hiện đại tự nhiên / Pha trộn]
Cấm: [cấm từ hiện đại / cấm từ cổ phong / không cấm]
---END---`;

/**
 * Scan novel to detect genre, style, and banned words.
 */
export async function scanNovelStyle(
  novelId: string,
  model: LanguageModel,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<string> {
  onProgress?.("Đang thu thập mẫu...");

  const { sampleText, chapterCount } = await collectSampleText(novelId);

  onProgress?.(`Đang phân tích ${chapterCount} chương...`);

  const result = await streamText({
    model,
    system: SCAN_SYSTEM_PROMPT,
    prompt: sampleText,
    abortSignal: signal,
  });

  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
  }

  // Parse result
  const startIdx = text.indexOf("---BEGIN---");
  const endIdx = text.indexOf("---END---");
  
  let parsed: string;
  if (startIdx !== -1 && endIdx !== -1) {
    parsed = text.slice(startIdx + "---BEGIN---".length, endIdx).trim();
  } else {
    parsed = text.trim();
  }

  // Extract genre
  const genreMatch = parsed.match(/Thể loại:\s*(.+)/i);
  const genre = genreMatch?.[1]?.trim() || "";

  onProgress?.("Đang lưu...");

  // Save to novel
  await db.novels.update(novelId, {
    customTranslatePrompt: parsed,
    genre: genre,
    styleScannedAt: new Date(),
    updatedAt: new Date(),
  });

  return parsed;
}
