import { generateStructured } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY || "YOUR_API_KEY" });

const schema = z.object({
  suggestions: z.array(z.object({
    chinese: z.string(),
    vietnamese: z.string(),
    reason: z.string(),
    category: z.enum(["names", "names2", "phienam", "luatnhan", "tuvung", "ngucanh", "vietphrase"]),
    genre: z.string(),
    context_zh: z.string(),
  }))
});

const text = `随着这一声呼喊，他突然想到，这个所谓的系统到现在也没展示过什么威能啊，更没有给自己送上什么好处，连商城之类的都没有，除了在自己脑子里说话，以及给了一个面板，完全没体现出任何力量，自己干嘛那么怕它？万一是个骗子呢？
然而就在他这么想的时候，那个面板上代表着魂灯属性的数值15，开始一点一点的往下降。
当数值降到9的时候，龙涛突然感到浑身一阵阴冷，双腿发软直接跪了下去，等降到6的时候，他已经开始意识模糊，面色发黑，一副油尽灯枯的模样。
“我...我知道了，我会去完成那个签到任务，别...别真杀我啊......”
光速认怂后，魂灯数值重新回到了15，那股令人毛骨悚然的阴冷感如潮水般退去，龙涛瘫坐在地上，后背的衣衫已被冷汗浸透。这一下是真把他搞怕了，不管是真是假，起码这个系统是有着杀死自己的能力的，不能随便违逆。`;

async function test() {
  try {
    const res = await generateStructured({
      model: google("gemini-2.5-flash"),
      schema,
      system: "Bạn là chuyên gia biên soạn từ điển Trung-Việt.",
      prompt: `
<task>
Hãy đọc đoạn văn bản tiếng Trung dưới đây và trích xuất ra các Tên riêng, Thuật ngữ chuyên môn, Danh xưng, và Cụm từ khó dịch.
Sau đó đề xuất nghĩa tiếng Việt chuẩn xác nhất cho từng từ đó để người dùng có thể thêm vào từ điển cá nhân.
</task>
<source_text lang="zh">
${text}
</source_text>
<requirements>
1. Tập trung vào Tên nhân vật, Tên địa danh, Cảnh giới, Môn phái, Chiêu thức, Đồ vật đặc biệt.
2. Tập trung vào các đại từ nhân xưng, xưng hô đặc thù (VD: vi sư, lão phu, trẫm, thần thiếp...).
3. Tập trung vào các từ lóng, cụm từ lặp, idiom (thành ngữ).
4. Phân loại bắt buộc vào một trong các loại từ điển sau (trường "category"):
   - "names": Tên riêng (nhân vật, tông môn, bí cảnh, thành phố...).
   - "names2": Bí danh, danh hiệu, tên khác.
   - "phienam": Phiên âm tên riêng, danh từ riêng (chỉ 1 chữ Hán).
   - "luatnhan": Đại từ nhân xưng, xưng hô (VD: ta/ngươi/hắn/nàng, lão phu/bản tọa, tiền bối/hậu bối, sư huynh...).
   - "tuvung": Từ vựng thể loại (Thuật ngữ tu luyện, kỹ năng, đan dược, công pháp...).
   - "ngucanh": Ngữ cảnh & Quy tắc dịch (Quy tắc đặc thù khi dịch từ/cụm từ cụ thể trong bối cảnh truyện).
   - "vietphrase": Từ điển phụ (Bổ sung từ vựng thông dụng đặc thù của thể loại, độ ưu tiên thấp hơn tên riêng/thuật ngữ).
5. BẮT BUỘC phân loại "genre": Bạn có thể chọn các thể loại chuẩn như: "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong", "dothi", "vongdu", "dongnhan", "ngontinh". TUYỆT ĐỐI KHÔNG SÁNG TẠO THỂ LOẠI MỚI.
6. QUY TẮC KHỚP THỂ LOẠI VÀ TỪ ĐIỂN (CỰC KỲ QUAN TRỌNG):
   - Bạn BẮT BUỘC phải chọn một thể loại cụ thể. Tuyệt đối KHÔNG ĐƯỢC dùng "global".
7. Với mỗi mục, phải có context_zh (câu gốc chứa từ đó).
8. BẮT BUỘC: Nghĩa tiếng Việt (vietnamese) PHẢI LÀ MỘT NGHĨA DUY NHẤT, chuẩn xác nhất. Tuyệt đối KHÔNG dùng dấu gạch chéo (/), KHÔNG liệt kê nhiều nghĩa.
</requirements>
<output_format>Trả về JSON chứa mảng "suggestions".</output_format>
`
    });
    console.log(JSON.stringify(res.object, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
