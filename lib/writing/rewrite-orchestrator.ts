import { db } from "@/lib/db";
import { generateText, streamText } from "ai";
import { resolveStep } from "@/lib/ai/resolve-step";
import { searchNovelContext, storeNovelEmbeddings } from "@/lib/writing/rag-client";
import { getDefaultPrompt, NSFW_INSTRUCTION } from "@/lib/writing/prompts";

export interface RewritePipelineOptions {
  novelId: string;
  abortSignal?: AbortSignal;
  onPhase?: (phase: string) => void;
  onChunk?: (text: string) => void;
  maxChapters?: number;
  autoExtractNames?: boolean;
  enableNsfw?: boolean;
}

export async function runRewritePipeline(options: RewritePipelineOptions) {
  const { novelId, abortSignal, onPhase, onChunk, autoExtractNames, enableNsfw } = options;

  const novel = await db.novels.get(novelId);
  if (!novel) throw new Error("Không tìm thấy dự án Rewrite.");

  let refChapters;
  let myChapters;

  if (novel.referenceNovelId) {
    refChapters = await db.chapters.where("novelId").equals(novel.referenceNovelId).sortBy("order");
    myChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
  } else {
    // In-place rewrite
    const allChapters = await db.chapters.where("novelId").equals(novelId).sortBy("order");
    refChapters = allChapters.filter(c => !c.isAiWritten);
    myChapters = allChapters.filter(c => !!c.isAiWritten);
  }

  if (refChapters.length === 0) throw new Error("Truyện gốc không có chương nào để tham khảo.");

  const writtenOrders = new Set(myChapters.map(c => c.order));

  // Determine chat provider
  const settings = await db.writingSettings.get(novelId);
  const rewriteModel = settings?.rewriteModel;
  
  let providerId = rewriteModel?.providerId;
  let modelId = rewriteModel?.modelId;

  if (!providerId || !modelId) {
    const chatSettings = await db.chatSettings.get("default");
    if (!chatSettings?.providerId || !chatSettings?.modelId) {
      throw new Error("Chưa cấu hình AI Provider. Vui lòng chọn Nhà cung cấp & Mô hình AI ở trên.");
    }
    providerId = chatSettings.providerId;
    modelId = chatSettings.modelId;
  }

  const provider = await db.aiProviders.get(providerId);
  if (!provider) throw new Error("Không tìm thấy cấu hình Provider.");

  const model = await resolveStep({
    providerId,
    modelId,
  });

  if (!model) throw new Error("Không thể khởi tạo mô hình AI.");

  // Vòng lặp tự động viết lại từng chương
  let writtenCount = 0;
  for (const refChapter of refChapters) {
    if (abortSignal?.aborted) break;
    if (options.maxChapters && writtenCount >= options.maxChapters) break;
    if (writtenOrders.has(refChapter.order)) continue;

    onPhase?.(`Đang xử lý Chương ${refChapter.order}...`);

    // 1. RAG Search: Lấy bối cảnh truyện mới từ Supabase
    onPhase?.(`[Chương ${refChapter.order}] Tìm kiếm ngữ cảnh RAG...`);
    // Lấy nội dung chương gốc (từ Scenes)
    const refScenes = await db.scenes.where("chapterId").equals(refChapter.id).sortBy("order");
    const refContent = refScenes.map(s => s.content).join("\n\n");
    if (!refContent.trim()) {
      console.warn(`Chương gốc ${refChapter.order} rỗng, bỏ qua.`);
      continue;
    }

    // Câu truy vấn RAG sẽ là ý tưởng chính + tóm tắt sương sương chương gốc
    const ragQuery = novel.rewriteIdea 
      ? `Ý tưởng Rewrite: ${novel.rewriteIdea}. Dựa vào diễn biến tiếp theo của chương ${refChapter.order}.`
      : `Tìm các chi tiết nhất quán (xưng hô, diễn biến) nối tiếp chương ${refChapter.order}.`;
    
    let ragContext = "";
    try {
      ragContext = await searchNovelContext({
        novelId,
        query: ragQuery,
        provider
      });
    } catch (e: any) {
      console.warn("Lỗi khi tìm ngữ cảnh RAG (Provider có thể không hỗ trợ embedding):", e);
      // Bỏ qua RAG nếu lỗi
    }

    // 2. Viết nội dung mới
    onPhase?.(`[Chương ${refChapter.order}] AI đang viết chương mới...`);
    
    let systemPrompt = "";
    let userPrompt = "";

    if (novel.rewriteIdea && novel.rewriteIdea.trim().length > 0) {
      // Chế truyện (Fan-fic)
      systemPrompt = `Bạn là một tiểu thuyết gia chuyên nghiệp. Nhiệm vụ của bạn là VIẾT LẠI một chương truyện từ bản gốc.
YÊU CẦU BẮT BUỘC:
1. Giữ nguyên 100% văn phong, nhịp độ, bút lực, góc nhìn, xưng hô và thể loại của bản gốc.
2. THAY ĐỔI HOÀN TOÀN CỐT TRUYỆN VÀ NHÂN VẬT theo "Ý tưởng mới" của tác giả.
3. TUYỆT ĐỐI giữ nguyên 100% các danh từ riêng, tên địa danh, hệ thống tu luyện, tên vật phẩm/vũ khí, môn phái và cách xưng hô (ta, ngươi, sư huynh, đệ tử...) y hệt như bản gốc. Không được tự ý đổi tên hay danh xưng.
4. Độ dài chương mới phải tương đương chương gốc. Không được cắt xén, không được tóm tắt.
5. Không được có "sạn" logic. Dựa vào "Ngữ cảnh cũ" (RAG) để đảm bảo mạch truyện nối tiếp chính xác.
6. CHỈ TRẢ VỀ NỘI DUNG TRUYỆN MỚI, KHÔNG GIẢI THÍCH, KHÔNG THÊM TIÊU ĐỀ.`;

      userPrompt = `=== Ý TƯỞNG MỚI MÀ BẠN PHẢI THEO ĐUỔI ===
${novel.rewriteIdea}

=== NGỮ CẢNH CŨ TỪ CÁC CHƯƠNG BẢN MỚI TRƯỚC ĐÓ (RAG) ===
${ragContext ? ragContext : "Đây là chương đầu tiên, chưa có ngữ cảnh."}

=== NỘI DUNG CHƯƠNG GỐC CẦN THAM KHẢO VĂN PHONG VÀ ĐỘ DÀI ===
[Bản gốc] Chương ${refChapter.order}: ${refChapter.title}
${refContent}

Hãy viết bản mới cho chương này.`;
    } else {
      // Phóng tác (Chống bản quyền, giữ nguyên cốt truyện)
      systemPrompt = `Bạn là một tiểu thuyết gia chuyên nghiệp. Nhiệm vụ của bạn là PHÓNG TÁC (REWRITE) chương truyện dưới đây.
YÊU CẦU BẮT BUỘC:
1. Giữ nguyên hoàn toàn 100% cốt truyện, tình tiết, diễn biến, hệ thống sức mạnh, và tên nhân vật của bản gốc.
2. Bắt chước 100% văn phong, nhịp độ, góc nhìn, xưng hô của bản gốc.
3. TUYỆT ĐỐI giữ nguyên 100% các danh từ riêng, tên nhân vật, địa danh, tên vật phẩm, vũ khí, đan lô, bảo vật, công pháp, môn phái và cách xưng hô (ta, ngươi, sư huynh, trưởng lão, đệ tử...) y hệt như bản gốc. Không được tự ý đổi hay thay thế bằng từ đồng nghĩa.
4. BẠN PHẢI VIẾT LẠI BẰNG CÂU TỪ MỚI CỦA BẠN (để tránh đạo văn/bản quyền) nhưng không được làm mất đi cái hồn của truyện gốc. Đừng tóm tắt, hãy viết chi tiết.
5. Độ dài chương mới phải tương đương hoặc dài hơn chương gốc.
6. Dựa vào "Ngữ cảnh cũ" (RAG) để xưng hô và các chi tiết được nhất quán với các chương trước đó.
7. CHỈ TRẢ VỀ NỘI DUNG TRUYỆN MỚI, KHÔNG GIẢI THÍCH, KHÔNG THÊM TIÊU ĐỀ.`;

      userPrompt = `=== NGỮ CẢNH CŨ TỪ CÁC CHƯƠNG BẢN MỚI TRƯỚC ĐÓ (RAG) ===
${ragContext ? ragContext : "Đây là chương đầu tiên, chưa có ngữ cảnh."}

=== NỘI DUNG CHƯƠNG GỐC CẦN PHÓNG TÁC ===
[Bản gốc] Chương ${refChapter.order}: ${refChapter.title}
${refContent}

Hãy viết bản phóng tác mới cho chương này.`;
    }

    if (enableNsfw) {
      systemPrompt += `\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
    }

    const { text: newChapterContent } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal,
    });

    if (!newChapterContent.trim()) {
      throw new Error(`AI trả về nội dung rỗng ở chương ${refChapter.order}`);
    }

    // 3. Sinh tiêu đề mới cho chương
    onPhase?.(`[Chương ${refChapter.order}] Tạo tiêu đề...`);
    const titleRes = await generateText({
      model,
      system: "Dựa vào nội dung chương sau, hãy đặt một tiêu đề thật hay, ngắn gọn (dưới 15 từ). Chỉ trả về tiêu đề, không ngoặc kép.",
      prompt: newChapterContent,
      abortSignal,
    });
    const newTitle = titleRes.text.trim();

    let cleanTitle = newTitle.replace(/^Chương\s*\d+[:\-.\s]*/i, "").trim();
    const formattedTitle = cleanTitle ? `Chương ${refChapter.order + 1}: ${cleanTitle}` : `Chương ${refChapter.order + 1}`;

    // 4. Lưu vào cơ sở dữ liệu
    onPhase?.(`[Chương ${refChapter.order}] Lưu dữ liệu...`);
    const newChapterId = crypto.randomUUID();
    const now = new Date();
    await db.chapters.add({
      id: newChapterId,
      novelId: novel.id,
      title: formattedTitle,
      order: refChapter.order,
      status: "published",
      isAiWritten: true,
      wordCount: newChapterContent.split(/\s+/).length,
      createdAt: now,
      updatedAt: now,
    });

    await db.scenes.add({
      id: crypto.randomUUID(),
      chapterId: newChapterId,
      novelId: novel.id,
      title: formattedTitle,
      content: newChapterContent,
      order: 1,
      wordCount: newChapterContent.split(/\s+/).length,
      version: 1,
      versionType: "ai-write",
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    });

    // 5. Trích xuất tên riêng nếu được yêu cầu
    if (autoExtractNames) {
      onPhase?.(`[Chương ${refChapter.order + 1}] Trích xuất tên riêng...`);
      try {
        const { generateStructured } = await import("@/lib/ai/index");
        const { jsonSchema } = await import("ai");
        
        const extractSchema = jsonSchema<{
          entities: {
            name: string;
            category: "nhân vật" | "địa danh" | "môn phái" | "vật phẩm" | "kỹ năng" | "thuật ngữ" | "khác";
            description: string;
          }[]
        }>({
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  category: { 
                    type: "string", 
                    enum: ["nhân vật", "địa danh", "môn phái", "vật phẩm", "kỹ năng", "thuật ngữ", "khác"] 
                  },
                  description: { type: "string" }
                },
                required: ["name", "category", "description"]
              }
            }
          },
          required: ["entities"]
        });

        const extProviderId = (settings as any).rewrite_extractModel?.providerId || providerId;
        const extModelId = (settings as any).rewrite_extractModel?.modelId || modelId;
        const extractorModel = await resolveStep({ providerId: extProviderId, modelId: extModelId });

        if (!extractorModel) {
          throw new Error("Không thể khởi tạo mô hình AI cho trích xuất.");
        }

        const extractRes = await generateStructured({
          model: extractorModel,
          schema: extractSchema,
          system: "Bạn là chuyên gia phân tích tiểu thuyết. Đọc chương văn bản sau và trích xuất TOÀN BỘ các danh từ riêng quan trọng (tên nhân vật, địa danh, tên môn phái/thế lực, vật phẩm, kỹ năng). Với mỗi tên, hãy chọn category phù hợp và viết 1 câu mô tả ngắn gọn vai trò của nó trong truyện.",
          prompt: newChapterContent,
          abortSignal,
        });

        const entities = extractRes.object.entities || [];
        if (entities.length > 0) {
          onPhase?.(`[Chương ${refChapter.order + 1}] Lưu ${entities.length} tên riêng...`);
          
          const aiScope = `ai_${novelId}`;
          const existingNames = await db.nameEntries.where("scope").equals(aiScope).toArray();
          const existingSet = new Set(existingNames.map(n => n.vietnamese.toLowerCase()));

          // Thêm vào từ điển tên
          const newEntries = entities
            .filter(e => e.name && !existingSet.has(e.name.toLowerCase()))
            .map(e => ({
              id: crypto.randomUUID(),
              scope: aiScope,
              chinese: e.name,
              vietnamese: e.name,
              category: e.category,
              createdAt: now,
              updatedAt: now,
            }));

          if (newEntries.length > 0) {
            await db.nameEntries.bulkAdd(newEntries);
          }

          // Cập nhật bảng Characters (Nhân vật tab)
          const existingChars = await db.characters.where("novelId").equals(novelId).toArray();
          const existingCharSet = new Set(existingChars.map(c => c.name.toLowerCase()));

          const newChars = entities
            .filter(e => e.category === "nhân vật" && e.name && !existingCharSet.has(e.name.toLowerCase()))
            .map(e => ({
              id: crypto.randomUUID(),
              novelId: novelId,
              name: e.name,
              role: "phụ",
              description: e.description,
              createdAt: now,
              updatedAt: now,
            }));

          if (newChars.length > 0) {
            await db.characters.bulkAdd(newChars);
          }

          // Cập nhật Novel Factions (Thế giới quan tab)
          let shouldUpdateNovel = false;
          const freshNovel = await db.novels.get(novelId);
          if (freshNovel) {
            const currentFactions = freshNovel.factions || [];
            const factionSet = new Set(currentFactions.map(f => f.name.toLowerCase()));
            
            entities.filter(e => e.category === "môn phái" && e.name).forEach(e => {
              if (!factionSet.has(e.name.toLowerCase())) {
                currentFactions.push({ name: e.name, description: e.description });
                factionSet.add(e.name.toLowerCase());
                shouldUpdateNovel = true;
              }
            });

            // Cập nhật Novel Key Locations (Thế giới quan tab)
            const currentLocs = freshNovel.keyLocations || [];
            const locSet = new Set(currentLocs.map(l => l.name.toLowerCase()));
            
            entities.filter(e => e.category === "địa danh" && e.name).forEach(e => {
              if (!locSet.has(e.name.toLowerCase())) {
                currentLocs.push({ name: e.name, description: e.description });
                locSet.add(e.name.toLowerCase());
                shouldUpdateNovel = true;
              }
            });

            if (shouldUpdateNovel) {
              await db.novels.update(novelId, {
                factions: currentFactions,
                keyLocations: currentLocs,
                updatedAt: now
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[Chương ${refChapter.order + 1}] Lỗi khi trích xuất tên riêng:`, err);
      }
    }

    // 6. Cập nhật RAG (Chunking và lưu vào Supabase)
    onPhase?.(`[Chương ${refChapter.order}] Đồng bộ RAG lên Supabase...`);
    try {
      await storeNovelEmbeddings({
        novelId,
        chapterId: newChapterId,
        chapterOrder: refChapter.order,
        content: newChapterContent,
        provider,
      });
    } catch (err: any) {
      console.warn("Lỗi khi lưu RAG:", err.message || err);
      // Tiếp tục dù lỗi RAG để không đứt chuỗi viết
    }
    
    // Emit chunk update just to notify UI
    onChunk?.(`[HOÀN THÀNH CHƯƠNG ${refChapter.order}] ${newTitle}`);
    writtenCount++;
  }

  onPhase?.("Hoàn tất chiến dịch Rewrite!");
}
