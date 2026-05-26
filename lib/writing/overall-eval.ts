import { db } from "@/lib/db";
import { resolveStep } from "@/lib/ai/resolve-step";
import { generateText } from "ai";

export async function generateOverallEvaluation(
  novelId: string,
  chapterPlansIds: string[],
): Promise<string> {
  const [novel, plans] = await Promise.all([
    db.novels.get(novelId),
    db.chapterPlans.where("novelId").equals(novelId).toArray(),
  ]);
  if (!novel) throw new Error("Novel not found");

  const targetPlans = plans
    .filter((p) => chapterPlansIds.includes(p.id))
    .sort((a, b) => a.chapterOrder - b.chapterOrder);

  if (targetPlans.length === 0) return "Chưa có chương nào được viết để đánh giá.";

  const scenesTextList = [];
  for (const plan of targetPlans) {
    if (plan.chapterId) {
      const scene = await db.scenes
        .where("chapterId")
        .equals(plan.chapterId)
        .filter((s) => s.isActive === 1)
        .first();
      if (scene) {
        scenesTextList.push(`--- Chương ${plan.chapterOrder}: ${plan.title || "Không có tiêu đề"} ---\nTóm tắt phân cảnh: ${plan.outline || "Chưa có giàn ý"}\n\nNội dung truyện:\n${scene.content.slice(0, 1500)}...\n[Đã ẩn bớt phần còn lại]`);
      }
    }
  }

  const chatSettings = await db.chatSettings.get("default");
  let model;
  if (chatSettings?.providerId && chatSettings?.modelId) {
    model = await resolveStep({
      providerId: chatSettings.providerId,
      modelId: chatSettings.modelId,
    });
  }
  if (!model) {
    throw new Error("Không tìm thấy cấu hình mô hình AI để chạy đánh giá.");
  }

  const systemPrompt = `Bạn là biên tập viên tiểu thuyết mạng cao cấp. Hãy đánh giá tổng quát chất lượng của nhóm chương mới được sáng tác dưới đây.
Đặc biệt chú ý đến các tiêu chí sau và phân tích chi tiết:
1. Sự mạch lạc của cốt truyện, tính hợp lý của các sự kiện và dòng chảy của mạch truyện.
2. Sự nhất quán trong góc nhìn (POV): ${novel.perspective || "Chưa phân tích"}
3. Sự nhất quán trong đại từ xưng hô: ${novel.pronouns || "Chưa phân tích"}
4. Sự nhất quán và độ mượt mà của phong cách hành văn: ${novel.writingStyle || "Chưa phân tích"}
5. Sự tăng tiến thực lực và sự phát triển, trưởng thành trong tâm lý/tính cách của nhân vật chính.
6. Những hạt sạn, chi tiết bất hợp lý hoặc mâu thuẫn cần khắc phục.

Hãy viết một báo cáo đánh giá tổng quát đầy đủ, trực quan bằng tiếng Việt dưới định dạng markdown. Sử dụng các tiêu đề, danh sách, và điểm nhấn để báo cáo rõ ràng và dễ đọc.`;

  const prompt = `Tên tác phẩm: ${novel.title}
Tóm tắt tổng quan: ${novel.synopsis || "Không có tóm tắt"}

Các chương cần đánh giá:
${scenesTextList.join("\n\n")}`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt,
  });

  return text;
}

export async function applyOverallEvaluationFixes(
  novelId: string,
  chapterPlansIds: string[],
  userInstructions: string,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const [novel, plans] = await Promise.all([
    db.novels.get(novelId),
    db.chapterPlans.where("novelId").equals(novelId).toArray(),
  ]);
  if (!novel) throw new Error("Novel not found");

  const targetPlans = plans
    .filter((p) => chapterPlansIds.includes(p.id))
    .sort((a, b) => a.chapterOrder - b.chapterOrder);

  if (targetPlans.length === 0) return;

  const chatSettings = await db.chatSettings.get("default");
  let model;
  if (chatSettings?.providerId && chatSettings?.modelId) {
    model = await resolveStep({
      providerId: chatSettings.providerId,
      modelId: chatSettings.modelId,
    });
  }
  if (!model) throw new Error("Không tìm thấy cấu hình mô hình AI.");

  for (const plan of targetPlans) {
    if (!plan.chapterId) continue;
    const scene = await db.scenes
      .where("chapterId")
      .equals(plan.chapterId)
      .filter((s) => s.isActive === 1)
      .first();

    if (!scene) continue;

    onProgress?.(`Đang tự động chỉnh sửa Chương ${plan.chapterOrder}: ${plan.title || "Chưa đặt tên"}...`);

    const rewritePrompt = `Bạn là tác giả và biên tập viên tiểu thuyết mạng chuyên nghiệp. Hãy viết lại chương truyện sau đây dựa theo chỉ dẫn chỉnh sửa từ người dùng.
BẮT BUỘC TUÂN THỦ CÁC THIẾT LẬP PHONG CÁCH SAU:
- Góc nhìn POV: ${novel.perspective || "Ngôi thứ ba"}
- Đại từ xưng hô: ${novel.pronouns || "hắn, nàng, y"}
- Phong cách hành văn: ${novel.writingStyle || "Convert chuẩn Trung-Việt"}

CHỈ DẪN CHỈNH SỬA TỪ NGƯỜI DÙNG:
${userInstructions}

Hãy sửa trực tiếp các hạt sạn và mâu thuẫn để chương truyện mượt mà hơn, đồng thời tuân thủ 100% các thiết lập phong cách đã nêu trên.
KHÔNG dùng bất kỳ ký hiệu markdown, in đậm, XML tag, hay ghi chú thêm. Hãy trả về văn bản chương truyện hoàn chỉnh từ đầu đến cuối.`;

    const prompt = `--- Nội dung gốc Chương ${plan.chapterOrder}: ${plan.title || "Chưa đặt tên"} ---\n${scene.content}`;

    const { text } = await generateText({
      model,
      system: rewritePrompt,
      prompt,
    });

    if (text.trim()) {
      await db.scenes.update(scene.id, { isActive: 0 });
      await db.scenes.add({
        id: crypto.randomUUID(),
        chapterId: plan.chapterId,
        novelId,
        title: plan.title || scene.title,
        content: text.trim(),
        order: scene.order,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        version: scene.version + 1,
        versionType: "ai-edit",
        isActive: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  onProgress?.("Hoàn tất chỉnh sửa toàn bộ các chương!");
}
