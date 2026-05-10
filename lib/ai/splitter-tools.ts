import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";

export const SplitterResultSchema = z.object({
  results: z.array(z.object({
    chinese: z.string(),
    vietnamese: z.string(),
    category: z.enum(["target", "khac"]).describe("target: thuộc về thể loại đích, khac: không thuộc thể loại đích"),
  }))
});

export type SplitterResult = z.infer<typeof SplitterResultSchema>;

export async function splitDictionaryChunk(
  model: LanguageModel,
  targetGenre: string,
  entries: Array<{ chinese: string; vietnamese: string }>,
  signal?: AbortSignal,
): Promise<SplitterResult> {
  const inputText = entries.map(e => `${e.chinese}=${e.vietnamese}`).join("\\n");
  
  const systemPrompt = `# Vai trò
Bạn là một chuyên gia ngôn ngữ học tiếng Trung - Việt, chuyên biên soạn từ điển.

# Nhiệm vụ
Bạn sẽ nhận được một danh sách các từ vựng (Trung=Việt).
Nhiệm vụ của bạn là kiểm tra xem TỪNG TỪ CÓ THUỘC VỀ THỂ LOẠI "${targetGenre.toUpperCase()}" HAY KHÔNG.

# Phân loại:
- "target": Từ thuộc về thể loại ${targetGenre.toUpperCase()}.
- "khac": Từ KHÔNG thuộc về thể loại ${targetGenre.toUpperCase()}.

# Yêu cầu đầu ra:
Bạn phải trả về định dạng JSON chính xác theo cấu trúc yêu cầu, giữ nguyên "chinese" và "vietnamese" của từng từ, chỉ thêm trường "category" cho đúng.`;

  const { object } = await generateObject({
    model,
    system: systemPrompt,
    prompt: `Hãy phân loại danh sách từ vựng sau:\\n\\n${inputText}`,
    schema: SplitterResultSchema,
    abortSignal: signal,
  });

  return object;
}
