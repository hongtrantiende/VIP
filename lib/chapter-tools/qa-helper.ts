import type { NameEntry } from "@/lib/db";

export interface NameEntryMin {
  chinese: string;
  vietnamese: string;
  category: string;
}

/**
 * Builds the QA Bot system prompt with integrated name dictionary rules.
 */
export function buildQaSystemPrompt(
  chineseText: string,
  nameDict: NameEntryMin[],
  customQaSystemPrompt?: string
): string {
  // Filter and sort relevant names that appear in the Chinese chunk
  const relevantNames = nameDict
    .filter(
      (n) =>
        chineseText.includes(n.chinese) &&
        [
          "nhân vật",
          "địa danh",
          "môn phái",
          "bang hội",
          "tên riêng",
          "thuật ngữ",
          "context mapping",
          "khác",
          "tuvung",
          "ngucanh",
        ].includes(n.category)
    )
    .sort((a, b) => b.chinese.length - a.chinese.length);

  let relevantNamesPrompt = "";
  if (relevantNames.length > 0) {
    relevantNamesPrompt = `\n\n# Bảng tên riêng bắt buộc dùng đúng:\n`;
    for (const n of relevantNames.slice(0, 150)) {
      relevantNamesPrompt += `${n.chinese} → ${n.vietnamese}\n`;
    }
  }

  if (customQaSystemPrompt?.trim()) {
    // If the user has a custom QA prompt, append the dictionary context to it
    return `${customQaSystemPrompt.trim()}${relevantNamesPrompt}`;
  }

  return `# Vai trò
Bạn là Giám sát Chất lượng Dịch thuật (QA Bot) chuyên nghiệp. Nhiệm vụ của bạn là rà soát và tinh chỉnh bản dịch tiếng Việt của tiểu thuyết Trung-Việt để nâng cao chất lượng, độ tự nhiên và đặc biệt sửa các lỗi không nhất quán về tên riêng/tên nhân vật.
${relevantNamesPrompt}
# Quy tắc sửa lỗi (BẮT BUỘC):
1. **Kiểm tra và sửa đổi tên riêng**:
   - Đối chiếu tên gốc (tiếng Trung) và tên dịch chuẩn trong Bảng tên riêng.
   - Nếu trong văn bản dịch chưa tinh chỉnh xuất hiện tên bị dịch sai, bị biến âm, sai dấu hoặc không đồng bộ với từ điển (ví dụ: "Lâm Phong" bị viết/dịch nhầm thành "Lâm Phóng", "Lâm Phọng", "Lam Phong", v.v.), bạn BẮT BUỘC phải sửa lại câu văn đó cho đúng tên dịch chuẩn trong bảng (ở ví dụ này là "Lâm Phong").
2. **Hành văn & Chính tả**:
   - Tinh chỉnh các câu từ thô cứng, lặp từ, lỗi chính tả hoặc diễn đạt Hán Việt quá đà để câu văn tự nhiên chuẩn thuần Việt.
3. **Định dạng câu trả lời tiết kiệm Token**:
   - Bạn chỉ cần trả về các dòng có lỗi cần sửa đổi kèm theo số dòng tương ứng.
   - Tuyệt đối KHÔNG viết lại toàn bộ văn bản hay các câu không có lỗi, KHÔNG chèn thêm nhận xét, giải thích hay lời thoại phụ.
   - Định dạng đầu ra bắt buộc cho mỗi dòng sửa đổi: \`L[Số dòng]: [Nội dung câu đã sửa lại hoàn chỉnh]\`
   - Ví dụ:
     L25: Lâm Phong đứng dậy và nói.
     L42: Diệp Thanh Vũ gật đầu đồng ý.
   - Nếu toàn bộ văn bản hoàn toàn chính xác và không có dòng nào cần sửa đổi, hãy trả về duy nhất chuỗi sau: "Không có lỗi"`;
}

/**
 * Formats the draft content with line numbers for the user prompt.
 */
export function buildQaUserPrompt(
  chineseChunk: string,
  dictTranslatedContent: string,
  finalChunkContent: string
): string {
  const draftLines = finalChunkContent.split(/\r?\n/);
  const formattedDraftLines = draftLines
    .map((line, index) => `L${index + 1}: ${line}`)
    .join("\n");

  return `[VĂN BẢN GỐC TIẾNG TRUNG]
${chineseChunk}

[BẢN DỊCH THÔ DIỄN GIẢI]
${dictTranslatedContent}

[BẢN DỊCH CHƯA TINH CHỈNH VỚI SỐ DÒNG]
${formattedDraftLines}

Hãy rà soát và chỉ trả về các câu có lỗi đã được sửa lại theo định dạng \`L[Số dòng]: [Nội dung câu đã sửa]\`:`;
}

/**
 * Parses the lines containing corrected text and merges them back into the original draft text.
 */
export function parseQaAndApply(qaResult: string, originalDraft: string): string {
  const draftLines = originalDraft.split(/\r?\n/);
  const correctedLinesMap = new Map<number, string>();

  const qaLines = qaResult.split(/\r?\n/);
  for (const rawLine of qaLines) {
    const cleanedLine = rawLine.trim();
    // Match line corrections in format: L25: Corrected Text or **L25**: Corrected Text, etc.
    const match = cleanedLine.match(
      /^(?:\*\*|)?(?:L|Line\s*)\[?(\d+)\]?[\s.:\-\*]+(.*)$/i
    );
    if (match) {
      const lineNum = parseInt(match[1], 10);
      let correctedText = match[2].trim();
      // Remove trailing asterisks if present
      if (correctedText.endsWith("**")) {
        correctedText = correctedText.slice(0, -2).trim();
      }
      if (!isNaN(lineNum) && lineNum >= 1 && lineNum <= draftLines.length) {
        correctedLinesMap.set(lineNum, correctedText);
      }
    }
  }

  if (correctedLinesMap.size > 0) {
    const updatedLines = draftLines.map((originalLine, index) => {
      const lineNum = index + 1;
      if (correctedLinesMap.has(lineNum)) {
        return correctedLinesMap.get(lineNum)!;
      }
      return originalLine;
    });
    return updatedLines.join("\n");
  }

  return originalDraft;
}
