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

// ─── Auto Scanned Pronoun Relations ──────────────────────────

export interface ExtractedPronoun {
  speakerCn: string;     // Tên tiếng Trung người nói (ví dụ: 林枫)
  speakerVi: string;     // Tên tiếng Việt người nói (ví dụ: Lâm Phong)
  listenerCn: string;    // Tên tiếng Trung người nghe (ví dụ: 楚瑶)
  listenerVi: string;    // Tên tiếng Việt người nghe (ví dụ: Sở Dao)
  speakerPronoun: string; // Đại từ người nói tự xưng (ví dụ: anh, ta, tôi, đệ)
  listenerPronoun: string; // Đại từ gọi người nghe (ví dụ: em, nàng, cô, huynh)
}

const pronounSchema = jsonSchema<{ relations: ExtractedPronoun[] }>({
  type: "object",
  properties: {
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speakerCn: { type: "string", description: "Tên gốc tiếng Trung của người nói" },
          speakerVi: { type: "string", description: "Tên phiên âm Hán-Việt của người nói" },
          listenerCn: { type: "string", description: "Tên gốc tiếng Trung của người nghe" },
          listenerVi: { type: "string", description: "Tên phiên âm Hán-Việt của người nghe" },
          speakerPronoun: { type: "string", description: "Đại từ người nói tự xưng (ví dụ: anh, ta, tôi, đệ, sư phụ)" },
          listenerPronoun: { type: "string", description: "Đại từ gọi người nghe (ví dụ: em, nàng, cô, huynh, đồ nhi)" },
        },
        required: ["speakerCn", "speakerVi", "listenerCn", "listenerVi", "speakerPronoun", "listenerPronoun"],
      },
    },
  },
  required: ["relations"],
});

const SCAN_PRONOUNS_SYSTEM = `Bạn là chuyên gia phân tích hội thoại và đại từ nhân xưng trong tiểu thuyết Trung-Việt.
Nhiệm vụ: đọc đoạn văn tiếng Trung gốc và xác định cách xưng hô (đại từ nhân xưng) thực tế giữa các nhân vật trong hội thoại.
Quy tắc:
1. CHỈ trích xuất khi có hội thoại rõ ràng giữa 2 nhân vật và xác định được đại từ nhân xưng cụ thể của người nói và người nghe.
2. Cung cấp cả tên tiếng Trung gốc (ví dụ: "林枫", "楚瑶") và tên tiếng Việt Hán Việt dịch chuẩn của người nói và người nghe. Hãy tham khảo Bảng tên dịch chuẩn được cung cấp.
3. Trường "speakerCn" và "listenerCn" chứa chính xác chữ Hán gốc của nhân vật nói/nghe.
4. Trường "speakerVi" và "listenerVi" chứa tên tiếng Việt dịch chuẩn tương ứng (viết hoa các chữ cái đầu).
5. Trường "speakerPronoun" và "listenerPronoun" là các đại từ xưng hô tiếng Việt tự nhiên và phù hợp nhất với ngữ cảnh hội thoại (ví dụ: "anh", "em", "ta", "nàng", "tôi", "cô", "sư phụ", "đồ nhi").
6. Trả về định dạng JSON theo đúng schema yêu cầu, không thêm bớt giải thích.`;

export async function scanPronounRelations(opts: {
  model: LanguageModel;
  sourceText: string;
  existingDict: Map<string, string>;
  signal?: AbortSignal;
}): Promise<ExtractedPronoun[]> {
  const { model, sourceText, existingDict, signal } = opts;

  if (sourceText.length < 100) return [];

  try {
    const dictContext = Array.from(existingDict.entries())
      .slice(0, 150) // Giới hạn số lượng tên riêng tránh quá tải prompt
      .map(([cn, vi]) => `${cn} -> ${vi}`)
      .join("\n");

    const prompt = `[BẢNG TÊN DỊCH CHUẨN]
${dictContext}

[VĂN BẢN TIẾNG TRUNG]
${sourceText.slice(0, 3000)}`;

    const result = await generateStructured({
      model,
      schema: pronounSchema,
      system: SCAN_PRONOUNS_SYSTEM,
      prompt,
      abortSignal: signal,
    });

    return result.object.relations || [];
  } catch (err) {
    console.warn("[PronounScan] Failed to scan pronouns, continuing without:", err);
    return [];
  }
}

export async function autoUpdatePronounPrompt(
  novelId: string,
  relations: ExtractedPronoun[]
): Promise<number> {
  if (relations.length === 0) return 0;
  const now = new Date();

  // Đọc danh sách từ điển hiện có để tránh trùng lặp
  const existingEntries = await db.nameEntries
    .where("scope")
    .equals(novelId)
    .toArray();

  const existingMap = new Map(existingEntries.map(e => [e.chinese, e]));
  const toAdd = [];
  const toUpdate = [];

  let addedCount = 0;

  for (const r of relations) {
    if (!r.speakerCn || !r.listenerCn || !r.speakerPronoun || !r.listenerPronoun) continue;

    const formatName = (name: string) => name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    const speakerFormatted = formatName(r.speakerVi || r.speakerCn);
    const listenerFormatted = formatName(r.listenerVi || r.listenerCn);

    const chineseKey = `${r.speakerCn.trim()}->${r.listenerCn.trim()}`;
    const vietnameseValue = `${r.speakerPronoun.trim()}->${r.listenerPronoun.trim()}|${speakerFormatted}->${listenerFormatted}`;

    if (existingMap.has(chineseKey)) {
      const entry = existingMap.get(chineseKey)!;
      if (entry.vietnamese !== vietnameseValue && entry.category === "xưng hô") {
        entry.vietnamese = vietnameseValue;
        entry.updatedAt = now;
        toUpdate.push(entry);
      }
    } else {
      toAdd.push({
        id: crypto.randomUUID(),
        scope: novelId,
        chinese: chineseKey,
        vietnamese: vietnameseValue,
        category: "xưng hô",
        createdAt: now,
        updatedAt: now,
      });
      addedCount++;
    }
  }

  if (toAdd.length > 0) {
    await db.nameEntries.bulkAdd(toAdd);
  }
  if (toUpdate.length > 0) {
    await Promise.all(toUpdate.map(e => db.nameEntries.put(e)));
  }

  // Đồng bộ lại ma trận xưng hô customPronounPrompt của novel
  const latestEntries = await db.nameEntries
    .where("scope")
    .equals(novelId)
    .toArray();

  const pronounEntries = latestEntries.filter(e => e.category === "xưng hô");
  let pronounPrompt = "";
  for (const e of pronounEntries) {
    const parts = e.vietnamese.split("|");
    const pronPart = parts[0];
    const namePart = parts[1] || "";

    const [speakerPron, listenerPron] = pronPart.split("->").map(s => s.trim());
    const [speakerName, listenerName] = namePart.split("->").map(s => s.trim());

    if (speakerName && listenerName && speakerPron && listenerPron) {
      pronounPrompt += `- ${speakerName} nói với ${listenerName}: ${speakerName} xưng "${speakerPron}", gọi ${listenerName} là "${listenerPron}"\n`;
    }
  }

  if (pronounPrompt) {
    await db.novels.update(novelId, {
      customPronounPrompt: pronounPrompt.trim(),
      updatedAt: now
    });
  }

  return addedCount;
}


