import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";

export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const { sampleText, provider, modelId: requestedModelId } = await req.json();

        if (!sampleText || typeof sampleText !== "string") {
            return NextResponse.json({ error: "Missing or invalid sampleText" }, { status: 400 });
        }

        if (!provider || !provider.providerType) {
            return NextResponse.json({ error: "Missing AI provider configuration" }, { status: 400 });
        }

        let modelId = requestedModelId || "gemini-2.5-flash"; // Default fast model for admin proxy

        // If no model passed, choose model based on what is available in the user's config
        if (!requestedModelId) {
            const customModels = provider.models || [];
            if (customModels.length > 0) {
                modelId = customModels[0].id;
            }
        }

        // Initialize the AI provider
        let aiModel;
        if (provider.providerType === "openai") {
            aiModel = createOpenAI({ apiKey: provider.apiKey })(modelId);
        } else {
            aiModel = createOpenAICompatible({
                name: "custom",
                baseURL: provider.baseUrl,
                apiKey: provider.apiKey || "sk-dummy",
            })(modelId);
        }

        const systemPrompt = `Bạn là chuyên gia về Regular Expression (Regex).
Người dùng sẽ cung cấp khoảng 1000 ký tự đầu tiên của một cuốn tiểu thuyết (Text).
Nhiệm vụ của bạn là:
1. Đọc lướt văn bản và tìm quy luật đánh dấu Tiêu Đề Chương. (Ví dụ: "Chương 1", "Chương 12: Tiêu đề", "Chapter 1", "第1章", "1. Tiêu đề").
2. Viết một biểu thức chính quy (Regex) bằng CÚ PHÁP JAVASCRIPT ĐỂ TÁCH CHƯƠNG.
3. Regex của bạn PHẢI bắt được trọn bộ toàn bộ tiêu đề (cả phần số và phần chữ phía sau nếu có) cho đến hết dòng. Dùng ^ để bắt đầu dòng (nhớ kết hợp với flag 'm' hoặc viết dạng bắt đầu dòng nếu cần thiết) và $ để kết thúc dòng nếu không muốn lấy dư.
Ví dụ nếu Text là tiếng Việt: ^[ \t]*Chương\s+\d+(?:.*)?$
Ví dụ nếu Text là tiếng Trung: ^[ \t]*第[\d零一二三四五六七八九十百千万]+[章回节卷折](?:.*)?$

BẮT BUỘC CHỈ TRẢ VỀ DUY NHẤT 1 CHUỖI REGEX, KHÔNG KÈM THEO BẤT KỲ DẤU NGOẶC KÉP, KHÔNG CÓ CỜ (FLAGS NHƯ /gm Ở CUỐI) VÀ KHÔNG KÈM LỜI GIẢI THÍCH NÀO KHÁC. KHÔNG VIẾT DẤU / Ở ĐẦU VÀ CUỐI.
Ví dụ output chuẩn:
^[ \t]*Chương\\s+\\d+(?:.*)?$
`;

        const result = await generateText({
            model: aiModel,
            system: systemPrompt,
            prompt: `[TEXT CỦA TÔI ĐÂY]\n${sampleText.substring(0, 3000)}`,
        });

        let regexStr = result.text.trim();
        // Clean up if AI wraps it in markdown code block or adds flags
        regexStr = regexStr.replace(/^```regex\s*/i, "").replace(/^```\s*/, "").replace(/```$/g, "").trim();
        if (regexStr.startsWith('/') && regexStr.lastIndexOf('/') > 0) {
            regexStr = regexStr.substring(1, regexStr.lastIndexOf('/'));
        }

        return NextResponse.json({ success: true, regex: regexStr });

    } catch (error: any) {
        console.error("AI Regex Detect error:", error);
        return NextResponse.json({ error: error.message || "Unknown error" }, { status: 500 });
    }
}
