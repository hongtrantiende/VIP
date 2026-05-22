/**
 * Pre-scan a chapter's source text for NEW character names not yet in the dictionary.
 * Uses a lightweight AI call to extract names, then auto-adds them to the novel's dictionary.
 * This runs BEFORE each chapter translation to ensure name consistency.
 */
import { generateStructured } from "@/lib/ai";
import { jsonSchema } from "ai";
import type { LanguageModel } from "ai";
import { db } from "@/lib/db";

interface ExtractedName {
  chinese: string;
  vietnamese: string;
}

const nameSchema = jsonSchema<{ names: ExtractedName[] }>({
  type: "object",
  properties: {
    names: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chinese: { type: "string", description: "Tên gốc tiếng Trung" },
          vietnamese: { type: "string", description: "Tên phiên âm Hán-Việt" },
        },
        required: ["chinese", "vietnamese"],
      },
    },
  },
  required: ["names"],
});

const SCAN_NAMES_SYSTEM = `Bạn là chuyên gia phiên âm Hán-Việt. Nhiệm vụ: trích xuất TẤT CẢ tên riêng (nhân vật, địa danh, tông môn, bí kỹ) từ đoạn văn tiếng Trung và phiên âm Hán-Việt chuẩn xác.
Quy tắc:
- CHỈ trích xuất tên riêng (danh từ riêng), KHÔNG trích xuất từ vựng thông thường hay đại từ nhân xưng.
- Trường "chinese" BẮT BUỘC phải chứa chính xác chữ Hán gốc (chữ Trung Quốc) xuất hiện trong đoạn văn, KHÔNG được dịch nghĩa hay viết bằng Pinyin hoặc tiếng Anh.
- Trường "vietnamese" là phiên âm Hán-Việt chuẩn xác và tự nhiên của tên riêng đó.
- Phiên âm Hán-Việt chuẩn, nhất quán.
- Mỗi tên CHỈ 1 nghĩa duy nhất, KHÔNG dùng dấu gạch chéo.
- Trả về JSON, không giải thích.`;

/**
 * Extract character names from source text that are NOT already in the dictionary.
 * Returns only truly new names.
 */
export async function scanNewNames(opts: {
  model: LanguageModel;
  sourceText: string;
  novelId: string;
  existingDict: Map<string, string>;
  signal?: AbortSignal;
}): Promise<ExtractedName[]> {
  const { model, sourceText, novelId, existingDict, signal } = opts;

  // Skip if text is too short (unlikely to have meaningful names)
  if (sourceText.length < 50) return [];

  try {
    const result = await generateStructured({
      model,
      schema: nameSchema,
      system: SCAN_NAMES_SYSTEM,
      prompt: sourceText.slice(0, 2000), // Only scan first 2000 chars for speed
      abortSignal: signal,
    });

    const allNames = result.object.names || [];

    // Filter out names already in dictionary
    const newNames = allNames.filter(
      (n) => n.chinese && n.vietnamese && !existingDict.has(n.chinese)
    );

    return newNames;
  } catch (err) {
    // Non-critical: if name scan fails, just continue without it
    console.warn("[NameScan] Failed to scan names, continuing without:", err);
    return [];
  }
}

/**
 * Auto-add new names to the novel's dictionary (scope = novelId).
 */
export async function autoAddNames(
  novelId: string,
  names: ExtractedName[],
): Promise<number> {
  if (names.length === 0) return 0;

  const now = new Date();

  // Check for duplicates in the novel scope
  const existing = await db.nameEntries
    .where("scope")
    .equals(novelId)
    .toArray();
  const existingSet = new Set(existing.map((e) => e.chinese));

  const toAdd = names
    .filter((n) => !existingSet.has(n.chinese))
    .map((n) => ({
      id: crypto.randomUUID(),
      scope: novelId,
      chinese: n.chinese,
      vietnamese: n.vietnamese,
      category: "names" as const,
      createdAt: now,
      updatedAt: now,
    }));

  if (toAdd.length > 0) {
    await db.nameEntries.bulkAdd(toAdd);
  }

  return toAdd.length;
}
