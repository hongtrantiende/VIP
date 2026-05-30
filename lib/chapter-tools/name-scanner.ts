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
  dictType?: "names" | "tuvung" | "ngucanh";
}

const nameSchema = jsonSchema<{ names: ExtractedName[] }>({
  type: "object",
  properties: {
    names: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chinese: { type: "string", description: "Tên gốc chữ Hán tiếng Trung xuất hiện trong văn bản" },
          vietnamese: { type: "string", description: "Nghĩa dịch, phiên âm Hán-Việt hoặc Romaji tương ứng" },
          dictType: { 
            type: "string", 
            enum: ["names", "tuvung", "ngucanh"], 
            description: "Phân loại: 'names' (tên người, nhân vật, địa danh, tông môn, bang hội), 'tuvung' (vật phẩm, kỹ năng, vũ khí, võ công, thuật ngữ, cảnh giới), 'ngucanh' (thành ngữ, cụm từ ngữ cảnh đặc biệt)" 
          }
        },
        required: ["chinese", "vietnamese", "dictType"],
      },
    },
  },
  required: ["names"],
});

const SCAN_NAMES_SYSTEM = `Bạn là chuyên gia dịch thuật, phân tích từ vựng và phiên âm tên riêng từ tiếng Trung. Nhiệm vụ: trích xuất TẤT CẢ các thực thể tên riêng, thuật ngữ, địa danh, vật phẩm, kỹ năng từ đoạn văn tiếng Trung và đưa ra nghĩa dịch hoặc phiên âm tương ứng kèm theo phân loại chính xác.
Quy tắc:
- CHỈ trích xuất các danh từ riêng, thuật ngữ đặc trưng, vật phẩm, võ công kỹ năng. KHÔNG trích xuất từ vựng thông thường hay đại từ nhân xưng thông dụng.
- Trường "chinese" BẮT BUỘC phải chứa chính xác chữ Hán gốc (chữ Trung Quốc) xuất hiện trong đoạn văn, KHÔNG được dịch nghĩa hay viết bằng Pinyin hoặc tiếng Anh.
- Trường "vietnamese" là nghĩa dịch tiếng Việt, phiên âm Hán-Việt chuẩn xác, hoặc phiên âm Romaji tương ứng (tùy thuộc hoàn toàn vào bối cảnh truyện và Quy tắc bổ sung từ người dùng).
- Trường "dictType" phân loại chính xác nhóm từ vựng theo đúng quy chuẩn:
  + 'names': Tên nhân vật (chính, phụ, các danh xưng riêng biệt), Địa danh (thành trì, bí cảnh, núi sông, tông môn, bang hội).
  + 'tuvung': Vật phẩm (vũ khí, thần binh, linh dược, đạo cụ), Kỹ năng (võ học, công pháp, bí tịch, thần thông), Thuật ngữ (cảnh giới tu luyện, hiệu ứng hệ thống).
  + 'ngucanh': Thành ngữ, cụm từ ngữ cảnh đặc trưng hoặc cách nói đặc sắc.
- Mỗi tên CHỈ 1 nghĩa duy nhất, KHÔNG dùng dấu gạch chéo.
- Trả về JSON, không giải thích.`;

/**
 * Extract character names from source text that are NOT already in the dictionary.
 * Returns only truly new names.
 * 
 * @param customScanPrompt - Optional custom prompt from user settings.
 *   If provided, it will be appended to the system prompt so the AI respects 
 *   user's name translation preferences (e.g., keeping Japanese/English names as-is).
 */
export async function scanNewNames(opts: {
  model: LanguageModel;
  sourceText: string;
  novelId: string;
  existingDict: Map<string, string>;
  customScanPrompt?: string;
  signal?: AbortSignal;
}): Promise<ExtractedName[]> {
  const { model, sourceText, novelId, existingDict, customScanPrompt, signal } = opts;

  // Skip if text is too short (unlikely to have meaningful names)
  if (sourceText.length < 50) return [];

  // ── Smart Context Auto-Detection from novel metadata ──
  let autoContextPrompt = "";
  try {
    const novel = await db.novels.get(novelId);
    if (novel) {
      const titleLower = novel.title.toLowerCase();
      const descLower = (novel.description || "").toLowerCase();
      const genreLower = (novel.genre || "").toLowerCase();
      const genresList = (novel.genres || []).map(g => g.toLowerCase());
      const tagsList = (novel.tags || []).map(t => t.toLowerCase());

      const isJapanese = 
        titleLower.includes("conan") || titleLower.includes("nhật bản") || titleLower.includes("anime") || titleLower.includes("manga") ||
        descLower.includes("nhật bản") || descLower.includes("conan") ||
        genreLower.includes("nhatban") || genreLower.includes("nhat") || genreLower.includes("japan") || genreLower.includes("conan") || genreLower.includes("anime") || genreLower.includes("manga") ||
        genresList.some(g => g.includes("nhat") || g.includes("japan") || g.includes("conan") || g.includes("anime") || g.includes("manga") || g.includes("dongnhan")) ||
        tagsList.some(t => t.includes("nhat") || t.includes("japan") || t.includes("conan") || t.includes("anime") || t.includes("manga"));

      const isWestern = 
        titleLower.includes("phương tây") || titleLower.includes("âu mỹ") || titleLower.includes("khoa học viễn tưởng") ||
        descLower.includes("phương tây") || descLower.includes("âu mỹ") ||
        genreLower.includes("tayphuong") || genreLower.includes("anhmy") || genreLower.includes("west") || genreLower.includes("fantasy") ||
        genresList.some(g => g.includes("tayphuong") || g.includes("west") || g.includes("fantasy") || g.includes("anhmy")) ||
        tagsList.some(t => t.includes("tayphuong") || t.includes("west") || t.includes("fantasy") || t.includes("anhmy"));

      if (isJapanese) {
        autoContextPrompt = `\n\n# CHỈ DẪN BỐI CẢNH TỰ ĐỘNG PHÁT HIỆN: NHẬT BẢN / ANIME / ROMAJI
- Truyện thuộc bối cảnh Nhật Bản hoặc Anime/Manga Nhật Bản.
- Tuyệt đối **KHÔNG** sử dụng âm Hán-Việt cho tên người và địa danh Nhật Bản.
- **BẮT BUỘC** phải dịch hoặc phiên âm sang chuẩn **Romaji** hoặc tên tiếng Nhật gốc tương ứng (Ví dụ: 毛利小五郎 BẮT BUỘC dịch là "Mouri Kogoro", 工藤新一 BẮT BUỘC dịch là "Kudo Shinichi", TUYỆT ĐỐI KHÔNG dùng phiên âm Hán-Việt như "Mao Lợi Tiểu Ngũ Lang" hay "Công Đằng Tân Nhất").`;
      } else if (isWestern) {
        autoContextPrompt = `\n\n# CHỈ DẪN BỐI CẢNH TỰ ĐỘNG PHÁT HIỆN: PHƯƠNG TÂY / ÂU MỸ / LATIN
- Truyện thuộc bối cảnh phương Tây, Âu Mỹ hoặc Fantasy ma pháp châu Âu.
- Tuyệt đối **KHÔNG** dịch tên người và địa danh sang phiên âm Hán-Việt cổ kính.
- **BẮT BUỘC** giữ nguyên tên tiếng Anh gốc hoặc phiên âm Latin phổ biến tương ứng (Ví dụ: Peter dịch là "Peter", Mary dịch là "Mary", London dịch là "London", TUYỆT ĐỐI KHÔNG dùng Hán-Việt như "Bỉ Đắc", "Mã Lệ", "Luân Đôn").`;
      } else {
        autoContextPrompt = `\n\n# CHỈ DẪN BỐI CẢNH TỰ ĐỘNG PHÁT HIỆN: CỔ TRANG / TIÊN HIỆP / HÁN VIỆT
- Truyện thuộc bối cảnh Trung Quốc, cổ trang hoặc Tiên hiệp/Huyền huyễn.
- **BẮT BUỘC** trích xuất và phiên âm chuẩn Hán-Việt viết hoa chữ cái đầu (Ví dụ: Tô Dật, Tiêu Viêm, Lâm Phong, Thanh Đường, võ công, pháp bảo...).`;
      }
    }
  } catch (err) {
    console.warn("[NameScan] Failed to auto-detect novel context:", err);
  }

  // Build system prompt: base + auto-detected context + user's custom rules
  let systemPrompt = SCAN_NAMES_SYSTEM + autoContextPrompt;
  if (customScanPrompt?.trim()) {
    systemPrompt += `\n\n# QUY TẮC BỔ SUNG TỪ NGƯỜI DÙNG (ƯU TIÊN CAO NHẤT - BẮT BUỘC TUÂN THỦ):
Quy tắc bổ sung được cung cấp dưới dạng JSON chứa các chỉ dẫn dịch thuật chuyên biệt. Hãy phân tích kỹ các trường sau và áp dụng chúng một cách tuyệt đối khi trích xuất và dịch nghĩa:
- "The_Loai" & "Boi_Canh": Xác định thể loại và bối cảnh chính xác để dịch chuẩn.
- "Quy_Tac_Dich_Ten_Nhan_Vat": Áp dụng quy tắc này để dịch/phiên âm các thực thể có dictType là 'names' (tên người, nhân vật).
- "Quy_Tac_Dich_Ten_Dia_Danh": Áp dụng để dịch/phiên âm các địa danh, tông môn, trường học thuộc dictType 'names'.
- "Quy_Tac_Dich_Ten_Ky_Nang": Áp dụng để dịch/phiên âm võ học, công pháp, phép thuật thuộc dictType 'tuvung'.
- "Quy_Tac_Dich_Ten_Vat_Pham": Áp dụng để dịch/phiên âm vũ khí, pháp bảo, vật phẩm thuộc dictType 'tuvung'.
- "Quy_Tac_Dich_Ten_Su_Kien": Áp dụng cho các chương trình, sự kiện.
- "Xung_Ho_Cot_Loi" & "Khi_Chat_Van_Phong": Tham khảo để định hình đại từ xưng hô và phong cách dịch.
- "Quy_Tac_Khuyen_Khich" & "Quy_Tac_Nghiem_Cam": Các thuật ngữ khuyến khích và cấm đoán tuyệt đối không được vi phạm khi dịch.

NỘI DUNG QUY TẮC JSON BỔ SUNG TỪ NGƯỜI DÙNG:
${customScanPrompt.trim()}`;
  }

  try {
    const result = await generateStructured({
      model,
      schema: nameSchema,
      system: systemPrompt,
      prompt: sourceText.slice(0, 2000), // Only scan first 2000 chars for speed
      abortSignal: signal,
    });

    try {
      const { useAiTranslateLogStore } = await import("@/lib/ai/translate-logger");
      useAiTranslateLogStore.getState().addModel2Log(novelId, {
        chapterTitle: `Quét từ điển (Chương dài ${sourceText.length} ký tự)`,
        systemPrompt,
        userPrompt: sourceText.slice(0, 2000),
        output: JSON.stringify(result.object.names || [], null, 2),
        timestamp: new Date(),
      });
    } catch (logErr) {
      console.warn("Failed to log scan names:", logErr);
    }

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
    .map((n) => {
      let vn = n.vietnamese.trim();
      const type = n.dictType || "names";

      // 1. Clear misplaced commas from names (e.g. 'Kisaki, Eri' -> 'Kisaki Eri')
      if (type === "names") {
        vn = vn.replace(/[,，]/g, " ").replace(/\s+/g, " ").trim();
      }

      // 2. Format capitalization according to category
      if (type === "names") {
        // Force Title Case for names/locations
        vn = vn.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      } else if (type === "tuvung" || type === "ngucanh") {
        // Lowercase terminology/phrases to prevent random mid-sentence capitalizations
        vn = vn.toLowerCase();
        // Capitalize the first letter of the first word (Sentence Case)
        vn = vn.charAt(0).toUpperCase() + vn.slice(1);
      }

      return {
        id: crypto.randomUUID(),
        scope: novelId,
        chinese: n.chinese,
        vietnamese: vn,
        category: type as "names" | "tuvung" | "ngucanh",
        createdAt: now,
        updatedAt: now,
      };
    });

  if (toAdd.length > 0) {
    await db.nameEntries.bulkAdd(toAdd);
    
    // Đẩy lên Cộng Đồng (Background)
    const novel = await db.novels.get(novelId);
    if (novel) {
      // Mặc định lấy thể loại đầu tiên, nếu không có thì gán 'core'
      const genre = (novel.genres && novel.genres.length > 0) ? novel.genres[0] : 'core';
      const content = toAdd.map(n => `${n.chinese}=${n.vietnamese}`).join('\n');
      
      // Không cần await vì upload chạy ngầm không ảnh hưởng UI
      fetch(`/api/dict/cloud-storage?action=contribute-community&genre=${encodeURIComponent(genre)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: content
      }).catch(err => console.error('Failed to push community dict:', err));
    }
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
          speakerVi: { type: "string", description: "Tên tiếng Việt của người nói — BẮT BUỘC lấy từ Bảng tên dịch chuẩn" },
          listenerCn: { type: "string", description: "Tên gốc tiếng Trung của người nghe" },
          listenerVi: { type: "string", description: "Tên tiếng Việt của người nghe — BẮT BUỘC lấy từ Bảng tên dịch chuẩn" },
          speakerPronoun: { type: "string", description: "Đại từ người nói tự xưng (ví dụ: anh, ta, tôi, đệ, sư phụ)" },
          listenerPronoun: { type: "string", description: "Đại từ gọi người nghe (ví dụ: em, nàng, cô, huynh, đồ nhi)" },
        },
        required: ["speakerCn", "speakerVi", "listenerCn", "listenerVi", "speakerPronoun", "listenerPronoun"],
      },
    },
  },
  required: ["relations"],
});

const SCAN_PRONOUNS_SYSTEM = `Bạn là chuyên gia phân tích hội thoại và đại từ nhân xưng trong tiểu thuyết.
Nhiệm vụ: đọc đoạn văn tiếng Trung gốc và xác định cách xưng hô (đại từ nhân xưng) thực tế giữa các nhân vật trong hội thoại.
Quy tắc:
1. CHỈ trích xuất khi có hội thoại rõ ràng giữa 2 nhân vật và xác định được đại từ nhân xưng cụ thể của người nói và người nghe.
2. Trường "speakerCn" và "listenerCn" chứa chính xác chữ Hán gốc của nhân vật nói/nghe.
3. Trường "speakerVi" và "listenerVi" BẮT BUỘC phải COPY CHÍNH XÁC tên tiếng Việt từ [BẢNG TÊN DỊCH CHUẨN] được cung cấp. TUYỆT ĐỐI KHÔNG tự ý phiên âm hay dịch lại tên. Nếu tên không có trong bảng, hãy bỏ qua nhân vật đó.
4. Trường "speakerPronoun" và "listenerPronoun" là các đại từ xưng hô tiếng Việt tự nhiên và phù hợp nhất với ngữ cảnh hội thoại (ví dụ: "anh", "em", "ta", "nàng", "tôi", "cô", "sư phụ", "đồ nhi").
5. Trả về định dạng JSON theo đúng schema yêu cầu, không thêm bớt giải thích.`;

/**
 * Scan pronoun relationships between characters from source text.
 * 
 * @param customScanPrompt - Optional custom prompt from user settings.
 *   Appended to system prompt so the AI respects user's naming conventions.
 */
export async function scanPronounRelations(opts: {
  model: LanguageModel;
  sourceText: string;
  existingDict: Map<string, string>;
  customScanPrompt?: string;
  signal?: AbortSignal;
  novelId?: string;
}): Promise<ExtractedPronoun[]> {
  const { model, sourceText, existingDict, customScanPrompt, signal, novelId } = opts;

  if (sourceText.length < 100) return [];

  try {
    const relevantNames = Array.from(existingDict.entries())
      .filter(([cn]) => sourceText.includes(cn));

    const dictContext = relevantNames
      .slice(0, 150) // Giới hạn số lượng tên riêng tránh quá tải prompt
      .map(([cn, vi]) => `${cn} -> ${vi}`)
      .join("\n");

    // Build system prompt: base + user's custom rules
    let systemPrompt = SCAN_PRONOUNS_SYSTEM;
    if (customScanPrompt?.trim()) {
      systemPrompt += `\n\n# QUY TẮC BỔ SUNG TỪ NGƯỜI DÙNG (ƯU TIÊN CAO NHẤT - BẮT BUỘC TUÂN THỦ):
Quy tắc bổ sung được cung cấp dưới dạng JSON chứa các chỉ dẫn dịch thuật và mối quan hệ nhân xưng. Hãy phân tích kỹ các trường sau và áp dụng chúng một cách tuyệt đối để xác định đại từ nhân xưng:
- "The_Loai" & "Boi_Canh": Xác định thể loại và bối cảnh để dịch chuẩn đại từ.
- "Xung_Ho_Cot_Loi": Chỉ dẫn quan trọng nhất về cách xưng hô thực tế giữa các nhân vật chính/phụ (như Mouri Kogoro tự xưng ta/tôi, ba - con với Ran...). Hãy tuân thủ tuyệt đối quy tắc xưng xô này khi phân tích đối thoại.
- "Khi_Chat_Van_Phong": Giọng điệu và phong thái xưng hô.
- "Quy_Tac_Khuyen_Khich" & "Quy_Tac_Nghiem_Cam": Các đại từ khuyến khích hoặc nghiêm cấm sử dụng.

NỘI DUNG QUY TẮC JSON BỔ SUNG TỪ NGƯỜI DÙNG:
${customScanPrompt.trim()}`;
    }

    const prompt = `[BẢNG TÊN DỊCH CHUẨN — BẮT BUỘC DÙNG ĐÚNG TÊN NÀY, KHÔNG TỰ Ý DỊCH LẠI]
${dictContext}

[VĂN BẢN TIẾNG TRUNG]
${sourceText.slice(0, 3000)}`;

    const result = await generateStructured({
      model,
      schema: pronounSchema,
      system: systemPrompt,
      prompt,
      abortSignal: signal,
    });

    if (novelId) {
      try {
        const { useAiTranslateLogStore } = await import("@/lib/ai/translate-logger");
        useAiTranslateLogStore.getState().addModel2Log(novelId, {
          chapterTitle: `Quét xưng hô (Chương dài ${sourceText.length} ký tự)`,
          systemPrompt,
          userPrompt: prompt,
          output: JSON.stringify(result.object.relations || [], null, 2),
          timestamp: new Date(),
        });
      } catch (logErr) {
        console.warn("Failed to log scan pronouns:", logErr);
      }
    }

    return result.object.relations || [];
  } catch (err) {
    console.warn("[PronounScan] Failed to scan pronouns, continuing without:", err);
    return [];
  }
}

/**
 * Auto-update the novel's pronoun prompt based on extracted pronoun relations.
 * 
 * CRITICAL: Uses `nameDict` to look up verified Vietnamese names instead of
 * trusting AI-returned speakerVi/listenerVi (which are often wrong for
 * Japanese/English names).
 * 
 * @param nameDict - The verified name dictionary (chinese -> vietnamese mapping)
 */
export async function autoUpdatePronounPrompt(
  novelId: string,
  relations: ExtractedPronoun[],
  nameDict?: Map<string, string>
): Promise<number> {
  if (relations.length === 0) return 0;
  const now = new Date();

  // Đọc danh sách từ điển hiện có để tránh trùng lặp
  const existingEntries = await db.nameEntries
    .where("scope")
    .equals(novelId)
    .toArray();

  // Build a lookup map from existing name entries (chinese -> vietnamese)
  // This is the VERIFIED dictionary — always prioritize over AI-returned names
  const verifiedNameMap = new Map<string, string>();
  for (const e of existingEntries) {
    if (e.category !== "xưng hô" && e.chinese && e.vietnamese) {
      verifiedNameMap.set(e.chinese, e.vietnamese);
    }
  }
  // Also merge the passed-in nameDict (which may be more complete/up-to-date)
  if (nameDict) {
    for (const [cn, vi] of nameDict.entries()) {
      if (!verifiedNameMap.has(cn)) {
        verifiedNameMap.set(cn, vi);
      }
    }
  }

  const existingMap = new Map(existingEntries.map(e => [e.chinese, e]));
  const toAdd = [];
  const toUpdate = [];

  let addedCount = 0;

  for (const r of relations) {
    if (!r.speakerCn || !r.listenerCn || !r.speakerPronoun || !r.listenerPronoun) continue;

    const formatName = (name: string) => name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

    // BUG FIX: Ưu tiên lấy tên từ từ điển đã xác minh, KHÔNG dùng tên AI trả về
    // Nếu không tìm thấy trong dict thì mới fallback dùng tên AI trả về
    const verifiedSpeaker = verifiedNameMap.get(r.speakerCn.trim());
    const verifiedListener = verifiedNameMap.get(r.listenerCn.trim());
    
    const speakerFormatted = formatName(verifiedSpeaker || r.speakerVi || r.speakerCn);
    const listenerFormatted = formatName(verifiedListener || r.listenerVi || r.listenerCn);

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


