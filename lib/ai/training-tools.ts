import { generateStructured } from "@/lib/ai";
import { jsonSchema } from "ai";
import type { LanguageModel } from "ai";

export interface TrainingSuggestion {
  chinese: string;
  vietnamese: string;
  reason: string;
  category: string;
  genre: string;
  context_zh?: string;
  context_vi_before?: string;
  context_vi_after?: string;
}

const trainingSchema = jsonSchema<{ suggestions: TrainingSuggestion[] }>({
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chinese: { type: "string" },
          vietnamese: { type: "string" },
          reason: { type: "string" },
          category: { type: "string" },
          genre: { type: "string" },
          context_zh: { type: "string" },
          context_vi_before: { type: "string" },
          context_vi_after: { type: "string" },
        },
        required: ["chinese", "vietnamese", "reason", "category", "genre", "context_zh", "context_vi_before", "context_vi_after"],
      },
    },
  },
  required: ["suggestions"],
});

export async function runTranslationTraining(opts: {
  model: LanguageModel;
  sourceText: string;
  qtTranslated: string;
  aiTranslated: string;
}): Promise<TrainingSuggestion[]> {
  const prompt = `
<role>
Bạn là chuyên gia huấn luyện hệ thống dịch thuật Trung-Việt, có kiến thức sâu sắc về văn học và tu tiên.
</role>

<task>
So sánh bản dịch máy (QT) và bản dịch AI chuyên nghiệp bên dưới để tìm ra các từ/cụm từ mà QT dịch chưa tốt, sai nghĩa, hoặc quá thô. 
Đề xuất các mục từ điển mới (Hán-Việt hoặc nghĩa chuẩn hơn) để bổ sung vào từ điển giúp bản dịch QT lần sau tốt hơn.
</task>

<source_text lang="zh">
${opts.sourceText.slice(0, 3000)}
</source_text>

<qt_translation lang="vi">
${opts.qtTranslated.slice(0, 3000)}
</qt_translation>

<ai_professional_translation lang="vi">
${opts.aiTranslated.slice(0, 3000)}
</ai_professional_translation>

<requirements>
1. Chỉ đề xuất các mục thực sự cải thiện được bản dịch máy (biến nó giống với bản dịch chuyên nghiệp hơn).
2. Phân loại bắt buộc theo một trong các nhóm sau: "Từ đơn", "Từ đôi", "Cụm hành động", "Cụm cảm xúc", "Trạng từ", "Từ nối", "Trợ từ", "Thuật ngữ tu tiên", "Phiên âm tên", "Pattern câu", "Context mapping", "Âm thanh".
3. Chú trọng vào việc sử dụng từ Hán-Việt cho các thuật ngữ tu tiên, chiêu thức và tên riêng để giữ đúng phong cách tiên hiệp/huyền huyễn.
4. Tránh dịch quá "thuần Việt" (quá hiện đại hoặc bình dân) cho các bối cảnh cổ đại/tu tiên.
5. Với mỗi đề xuất, hãy trích dẫn câu văn gốc chứa từ đó (context_zh), bản dịch hiện tại của QT cho câu đó (context_vi_before) và bản dịch đề xuất của bạn cho câu đó (context_vi_after) để người dùng đối chiếu.
6. Mỗi đề xuất phải có { chinese, vietnamese, reason, category, context_zh, context_vi_before, context_vi_after }.
</requirements>

<output_format>Trả về JSON chứa mảng "suggestions". Không giải thích gì thêm.</output_format>
`;

  const result = await generateStructured({
    model: opts.model,
    schema: trainingSchema,
    system: "Bạn là chuyên gia huấn luyện hệ thống dịch thuật Trung-Việt.",
    prompt,
  });

  return result.object.suggestions;
}

export async function extractDictionaryEntries(opts: {
  model: LanguageModel;
  sourceText: string;
  targetGenres?: string[];
}): Promise<TrainingSuggestion[]> {
  const hasSpecificGenres = opts.targetGenres && opts.targetGenres.length > 0 && !opts.targetGenres.includes("auto");
  const genresStr = hasSpecificGenres ? opts.targetGenres!.join('", "') : "";
  const genreInstruction = hasSpecificGenres 
    ? `5. BẮT BUỘC phân loại "genre": Bạn CHỈ ĐƯỢC CHỌN "global" (nếu là tên riêng, danh xưng chung) hoặc một trong các thể loại sau: "${genresStr}". TUYỆT ĐỐI KHÔNG chọn các thể loại khác.`
    : `5. BẮT BUỘC phân loại "genre" dựa trên bối cảnh của từ vựng đó. Bạn có thể chọn các thể loại chuẩn như: "ngontinh", "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong", "nsfw", "hentai", "dongphuong", "dothi", "vongdu", "khoahuyen", "quybi", "xuyenkhong", "hethong", "trinhtham", "lichsu", hoặc "global" (nếu là từ dùng chung). ĐẶC BIỆT: Nếu từ vựng phù hợp với nhiều thể loại hoặc thuộc một thể loại mới hoàn toàn chưa có trong danh sách, bạn CÓ THỂ tự do tạo và trả về chuỗi thể loại mới đó (ví dụ "hiendai,ngontinh" hoặc "haihuoc"). Vui lòng viết liền không dấu hoặc cách nhau bằng dấu phẩy.`;

  const prompt = `
<role>
Bạn là chuyên gia dịch thuật Trung-Việt và là người biên soạn từ điển chuyên ngành cho tiểu thuyết mạng.
</role>

<task>
Hãy đọc đoạn văn bản tiếng Trung dưới đây và trích xuất ra các Tên riêng, Thuật ngữ chuyên môn, Danh xưng, và Cụm từ khó dịch.
Sau đó đề xuất nghĩa tiếng Việt chuẩn xác nhất cho từng từ đó để người dùng có thể thêm vào từ điển cá nhân.
</task>

<source_text lang="zh">
${opts.sourceText.slice(0, 3000)}
</source_text>

<requirements>
1. Tập trung vào Tên nhân vật, Tên địa danh, Cảnh giới, Môn phái, Chiêu thức, Đồ vật đặc biệt.
2. Tập trung vào các đại từ nhân xưng, xưng hô đặc thù (VD: vi sư, lão phu, trẫm, thần thiếp...).
3. Tập trung vào các từ lóng, cụm từ lặp, idiom (thành ngữ).
4. Phân loại "category" vào: "Tên riêng", "Thuật ngữ", "Xưng hô", "Thành ngữ", "Khác".
${genreInstruction}
6. Với mỗi mục, phải có context_zh (câu gốc chứa từ đó) và context_vi_before/after (có thể để trống nếu không cần thiết).
7. BẮT BUỘC: Nghĩa tiếng Việt (vietnamese) PHẢI LÀ MỘT NGHĨA DUY NHẤT, chuẩn xác nhất. Tuyệt đối KHÔNG dùng dấu gạch chéo (/), KHÔNG liệt kê nhiều nghĩa (Ví dụ: Sai: "Tống Cẩu / Tống Chó", Đúng: "Tống Cẩu").
</requirements>

<output_format>Trả về JSON chứa mảng "suggestions".</output_format>
`;

  const result = await generateStructured({
    model: opts.model,
    schema: trainingSchema,
    system: "Bạn là chuyên gia biên soạn từ điển Trung-Việt.",
    prompt,
  });

  return result.object.suggestions;
}
