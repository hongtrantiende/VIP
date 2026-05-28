import { generateStructured } from "@/lib/ai";
import { jsonSchema } from "ai";
import type { LanguageModel } from "ai";

export interface TrainingSuggestion {
  chinese: string;
  vietnamese: string;
  reason: string;
  category: "names" | "names2" | "phienam" | "luatnhan" | "tuvung" | "ngucanh" | "vietphrase";
  genre: string;
  context_zh?: string;
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
          category: { type: "string", enum: ["names", "names2", "phienam", "luatnhan", "tuvung", "ngucanh", "vietphrase"] },
          genre: { type: "string" },
          context_zh: { type: "string" },
        },
        required: ["chinese", "vietnamese", "reason", "category", "genre", "context_zh"],
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
2. Phân loại bắt buộc vào một trong các loại từ điển sau (trường "category"):
   - "names": Tên riêng (nhân vật, tông môn, bí cảnh, thành phố...).
   - "names2": Bí danh, danh hiệu, tên khác.
   - "phienam": Phiên âm cho một Hán tự đơn lẻ đặc biệt (Phiên âm ký tự đơn).
   - "luatnhan": Luật nhân xưng (VD: ta/ngươi/hắn/nàng, lão phu/bản tọa, sư huynh...).
   - "tuvung": Từ vựng thể loại (Thuật ngữ tu luyện, kỹ năng, đan dược, công pháp...).
   - "ngucanh": Ngữ cảnh & Quy tắc dịch (Quy tắc đặc thù khi dịch từ/cụm từ cụ thể trong bối cảnh truyện).
   - "vietphrase": Từ điển phụ (Bổ sung từ vựng thông dụng đặc thù của thể loại, độ ưu tiên thấp hơn tên riêng/thuật ngữ).
3. Chú trọng vào việc sử dụng từ Hán-Việt cho các thuật ngữ tu tiên, chiêu thức và tên riêng để giữ đúng phong cách tiên hiệp/huyền huyễn.
4. Tránh dịch quá "thuần Việt" (quá hiện đại hoặc bình dân) cho các bối cảnh cổ đại/tu tiên.
5. Với mỗi đề xuất, hãy trích dẫn câu văn gốc chứa từ đó (context_zh) để người dùng đối chiếu.
6. Mỗi đề xuất phải có { chinese, vietnamese, reason, category, context_zh }.
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
  const mappingRules = `
6. QUY TẮC KHỚP THỂ LOẠI VÀ TỪ ĐIỂN (CỰC KỲ QUAN TRỌNG):
   - Bạn BẮT BUỘC phải chọn một thể loại cụ thể (VD: "tienhiep", "hocduong"...). 
   - Tuyệt đối KHÔNG ĐƯỢC dùng "global". Mọi từ vựng trích xuất đều phải thuộc về một thể loại truyện cụ thể.`;

  const genreInstruction = hasSpecificGenres 
    ? `5. BẮT BUỘC phân loại "genre": BẠN CHỈ ĐƯỢC CHỌN một trong các thể loại sau: "${genresStr}". TUYỆT ĐỐI KHÔNG SÁNG TẠO THỂ LOẠI MỚI.${mappingRules}`
    : `5. BẮT BUỘC phân loại "genre": Bạn có thể chọn các thể loại chuẩn như: "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong", "dothi", "vongdu", "dongnhan", "ngontinh". TUYỆT ĐỐI KHÔNG SÁNG TẠO THỂ LOẠI MỚI.${mappingRules}`;

  const prompt = `
<role>
Bạn là chuyên gia dịch thuật Trung-Việt và là người biên soạn từ điển chuyên ngành cho tiểu thuyết mạng.
</role>

<task>
Hãy đọc đoạn văn bản tiếng Trung dưới đây và TRÍCH XUẤT CÀNG NHIỀU TỪ VỰNG CÀNG TỐT (từ dễ đến khó).
Bao gồm: Tên riêng, Thuật ngữ, Danh xưng, Động từ, Tính từ, Từ lóng, Cụm từ thông dụng trong văn án, và bất cứ cụm từ nào có thể tạo thành mục từ điển.
Sau đó đề xuất nghĩa tiếng Việt chuẩn xác nhất cho từng từ đó.
</task>

<source_text lang="zh">
${opts.sourceText.slice(0, 3000)}
</source_text>

<requirements>
1. BẮT BUỘC trích xuất TẤT CẢ các từ/cụm từ có nghĩa (Từ dễ đến khó, từ thông dụng đến thuật ngữ chuyên sâu). Càng nhiều càng tốt.
2. Trích xuất đầy đủ Tên riêng: Tên nhân vật, Tên địa danh, Cảnh giới, Môn phái, Chiêu thức, Đồ vật đặc biệt.
3. Trích xuất đầy đủ Danh xưng: Đại từ nhân xưng, xưng hô đặc thù (VD: vi sư, lão phu, trẫm, thần thiếp...).
4. Trích xuất đầy đủ Từ vựng chung: Từ lóng, cụm từ lặp, thành ngữ, cụm động từ, cụm tính từ đặc trưng của tiếng Trung.
5. Phân loại bắt buộc vào một trong các loại từ điển sau (trường "category"):
   - "names": Tên riêng (nhân vật, tông môn, bí cảnh, thành phố...).
   - "names2": Bí danh, danh hiệu, tên khác.
   - "phienam": Phiên âm tên riêng, danh từ riêng (chỉ 1 chữ Hán).
   - "luatnhan": Đại từ nhân xưng, xưng hô (VD: ta/ngươi/hắn/nàng, lão phu/bản tọa, tiền bối/hậu bối, sư huynh...).
   - "tuvung": Từ vựng thể loại (Thuật ngữ tu luyện, kỹ năng, đan dược, công pháp...).
   - "ngucanh": Ngữ cảnh & Quy tắc dịch (Quy tắc đặc thù khi dịch từ/cụm từ cụ thể trong bối cảnh truyện).
   - "vietphrase": Từ điển phụ (Bổ sung từ vựng thông dụng đặc thù của thể loại, độ ưu tiên thấp hơn tên riêng/thuật ngữ).
${genreInstruction}
8. **Tên riêng Nhật Bản/Phương Tây**: BẮT BUỘC phải dùng Romaji hoặc tiếng Anh nguyên gốc cho nghĩa tiếng Việt (vietnamese) (ví dụ: Kudo, Tokyo, Harry). TUYỆT ĐỐI KHÔNG dịch thành âm Hán-Việt (như Công Đằng, Đông Kinh, Cáp Lợi).
9. Với mỗi mục, phải có context_zh (câu gốc chứa từ đó).
10. BẮT BUỘC: Nghĩa tiếng Việt (vietnamese) PHẢI LÀ MỘT NGHĨA DUY NHẤT, chuẩn xác nhất. Tuyệt đối KHÔNG dùng dấu gạch chéo (/), KHÔNG liệt kê nhiều nghĩa (Ví dụ: Sai: "Tống Cẩu / Tống Chó", Đúng: "Tống Cẩu").
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
