"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db";
import { useAnalysisSettings } from "@/lib/hooks/use-analysis-settings";
import { useChatSettings } from "@/lib/hooks/use-chat-settings";
import { useAIProvider, useApiInferenceProviders, useAIModels } from "@/lib/hooks/use-ai-providers";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StepModelConfig } from "@/lib/db";
import {
  resolveChapterToolModel,
  getChapterToolModelMissingMessage,
} from "@/lib/chapter-tools/stream-runner";
import { streamText } from "ai";
import { Loader2Icon, SparklesIcon, SaveIcon, RefreshCwIcon, CheckIcon } from "lucide-react";
import { useCallback, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";
import { getOriginalContent } from "@/lib/hooks/use-scene-versions";
import { useProfile } from "@/lib/hooks/use-profile";

const INITIAL_PROMPT = `Bạn là chuyên gia phân tích và dịch thuật tiểu thuyết mạng Trung Quốc hàng đầu, am hiểu cực sâu tất cả các thể loại: Tiên Hiệp, Huyền Huyễn, Đô Thị Tu Tiên, Ngôn Tình, Đam Mỹ, v.v 
Hãy đọc kỹ mẫu văn bản của bộ truyện và thực hiện nhiệm vụ sau một cách chính xác nhất có thể.

**Nhiệm vụ:**

1. **Xác định thể loại**
   - Thể loại chính (chỉ 1)
   - Thể loại phụ (có thể 1-2)
   - Mức độ: Huyền ảo cao / Thấp, Tập trung tu luyện / Hệ thống / Tình cảm / Trả thù / Ngọt ngược...

2. **Phân tích sâu phong cách truyện**
   - Tone tổng thể (lạnh lùng cao ngạo, hùng tráng máu me, ngọt sủng, đen tối, hài hước, kịch tính...)
   - Đặc điểm xưng hô nhân vật chính và phụ
   - Mức độ miêu tả (chiến đấu, nội tâm, thế giới quan, cảm xúc...)
   - Tác giả hay dùng thủ pháp gì (miêu tả dài, thoại nhiều, cliffhanger...)

3. **Tạo System Prompt dịch chuyên biệt** (rất mạnh, tối ưu token)
   - Phải dịch cực sát nghĩa gốc, không thêm thắt nội dung.
   - Xưng hô tuyệt đối chuẩn theo vai trò, cảnh giới, quan hệ.
   - Văn phong đúng thể loại + tone của truyện này.
   - Ưu tiên thuật ngữ nhất quán, mượt mà tự nhiên khi đọc.
   - Tiết kiệm token tối đa.

Trả về kết quả bằng tiếng Việt, trong đó phần "System Prompt dịch chuyên biệt" cần được đặt trong khối code markdown \`\`\` để tôi dễ dàng copy.`;

export function PromptTunerDialog({
  open,
  onOpenChange,
  novelId,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  novelId: string;
  mode: string;
}) {
  const [isScanning, setIsScanning] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [feedback, setFeedback] = useState("");

  const settings = useAnalysisSettings();
  const chatSettings = useChatSettings();
  const defaultProvider = useAIProvider(chatSettings?.providerId);

  const novel = useLiveQuery(() => db.novels.get(novelId), [novelId]);

  const { profile } = useProfile();

  const currentVnDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).toDateString();
  const rawQuota = (profile as any)?.admin_model_quota || 0;
  const dailyLimit = (profile as any)?.admin_daily_quota_limit || 0;
  const lastReset = (profile as any)?.admin_quota_last_reset || "";
  const displayQuota = (lastReset !== currentVnDate && dailyLimit > 0) ? dailyLimit : rawQuota;

  const providers = useApiInferenceProviders();
  const currentModel = useMemo(() => {
    if (novel?.customTranslateProviderId) {
      return {
        providerId: novel.customTranslateProviderId,
        modelId: novel.customTranslateModelId || "",
      };
    }
    return settings.translateModel as StepModelConfig | undefined;
  }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel]);

  const selectedProviderId = currentModel?.providerId ?? "";
  const models = useAIModels(selectedProviderId || undefined);

  const promptField = useMemo(() => {
    if (mode === "stv-prompt") return "customStvPrompt";
    if (mode === "comprehensive") return "customComprehensivePrompt";
    if (mode === "model2-prompt") return "customModel2Prompt";
    if (mode === "model3-prompt") return "customModel3Prompt";
    return "customTranslatePrompt";
  }, [mode]);


  const initialPromptText = useMemo(() => {
    if (mode === "stv-prompt") {
      return `Bạn là chuyên gia biên tập và làm mượt bản dịch tiểu thuyết Trung-Việt chuyên nghiệp.
Hãy phân tích mẫu truyện tiếng Trung và bản dịch thô tiếng Việt (STV) để sinh ra một System Prompt tinh chỉnh chuyên biệt nhằm hướng dẫn AI biên tập bản dịch thô thành tiếng Việt mượt mà văn học.

System Prompt được sinh phải đáp ứng các yêu cầu sau:
- Biên tập đúng thể loại (Tiên Hiệp, Đô Thị, Hệ Thống, v.v.), phong cách viết của tác giả.
- Đối chiếu bản gốc để sửa lỗi xưng hô, ngữ cảnh dịch sai lệch, và tên nhân vật.
- Hành văn ổn định sát truyện, mượt mà tự nhiên, giữ chất văn học cổ trang/kiếm hiệp khi cần thiết.
- Đảm bảo sát nghĩa bản gốc Trung Quốc, tuyệt đối không tự ý thêm bớt tình tiết.
- Viết ngắn gọn, chuẩn xác, không quá dài dòng cũng không quá sơ sài.
- **Giữ phong vị truyện (Tránh thuần Việt quá mức)**: Biên tập câu cú mượt mà theo ngữ pháp tiếng Việt, nhưng tuyệt đối không thuần Việt hóa quá đà làm mất đi phong vị đặc trưng của thể loại (như kiếm hiệp, tiên hiệp, tu tiên). Giữ lại các thuật ngữ Hán-Việt quen thuộc quen thuộc (như đan điền, tu vi, linh khí, tông môn, thần thông, ngự kiếm).
- **Tối ưu làm mượt cấu trúc câu STV**: Hướng dẫn AI phát hiện và tự động sửa các cụm từ thô cứng đặc trưng của bản dịch STV thô (như "hướng về phía trước đi" -> "bước tới", "nhẹ nhõm một hơi" -> "thở phào nhẹ nhõm", "bất quá" -> "tuy nhiên/có điều", "chợt thốt lên", "nói giọng mang theo...") thành văn phong thuần Việt uyển chuyển.

Kết quả trả về chỉ gồm System Prompt biên tập tiếng Việt đặt trong khối code markdown \`\`\`. Không ghi thêm lời giải thích nào khác.`;
    }

    if (mode === "comprehensive") {
      return `Bạn là chuyên gia biên dịch và thiết lập pipeline dịch thuật tiểu thuyết mạng Trung-Việt chuyên nghiệp.
Hãy phân tích mẫu truyện gốc tiếng Trung để biên soạn một System Prompt dịch nháp tối ưu, hướng dẫn AI phối hợp bản gốc tiếng Trung và Hán Việt để dịch ra văn bản tiếng Việt nháp (draft) chất lượng cao.

System Prompt được sinh phải đáp ứng các yêu cầu sau:
- Dịch nháp chuẩn xác đúng thể loại truyện (Tiên Hiệp, Đô Thị, Hệ Thống, v.v.) và phong cách của truyện gốc.
- Đảm bảo thế đúng tên riêng nhân vật, địa lý và quan hệ gia thế / xưng hô chuẩn bối cảnh.
- Hành văn ổn định sát truyện, đúng phong cách, tuyệt đối không tự ý thêm bớt nội dung.
- Viết ngắn gọn, chuẩn xác, không quá dài dòng cũng không quá sơ sài.
- **Giữ phong vị truyện (Tránh thuần Việt quá mức)**: Duy trì các thuật ngữ Hán-Việt kinh điển và xưng hô đặc trưng của truyện (đặc biệt là kiếm hiệp, tiên hiệp, huyền huyễn), tránh thuần Việt hóa quá đà các từ ngữ bối cảnh đã quá quen thuộc với độc giả Việt Nam.
- **Dịch thuật đa kênh chính xác**: Hướng dẫn AI đối chiếu logic từ vựng giữa bản gốc tiếng Trung và từ điển tên riêng/Hán Việt để tạo ra bản dịch nháp có tính đồng nhất cao nhất.

Kết quả trả về chỉ gồm System Prompt dịch nháp đặt trong khối code markdown \`\`\`. Không ghi thêm lời giải thích nào khác.`;
    }

    if (mode === "edit") {
      return `Bạn là chuyên gia biên tập, hiệu đính và làm mượt văn phong tiểu thuyết mạng Việt Nam chuyên nghiệp.
Hãy phân tích mẫu truyện tiếng Việt hiện tại để sinh ra một System Prompt biên tập chuyên biệt nhằm hướng dẫn AI biên tập, chau chuốt câu từ, sửa lỗi ngữ pháp, hành văn mượt mà, đúng thể loại và thuần Việt nhất.

System Prompt được sinh phải đáp ứng các yêu cầu sau:
- Biên tập đúng thể loại (Tiên Hiệp, Đô Thị, Hệ Thống, v.v.), phong cách viết của tác giả.
- Định hướng hành văn mượt mà, tự nhiên, giữ chất văn học.
- Đảm bảo sửa các lỗi lặp từ, lỗi chính tả, câu cú lủng củng.
- Tuyệt đối giữ nguyên cốt truyện, tình tiết và bối cảnh tên nhân vật. Không tự ý tóm tắt hay cắt xén nội dung.
- Viết ngắn gọn, chuẩn xác, không quá dài dòng cũng không quá sơ sài.
- **Giữ phong vị truyện (Tránh thuần Việt quá mức)**: Hiệu đính câu từ trôi chảy, chuẩn văn phạm tiếng Việt nhưng phải giữ trọn vẹn giọng điệu, không khí bối cảnh truyện gốc. Giữ lại các thuật ngữ Hán-Việt kinh điển, tránh thuần Việt hóa các từ quen thuộc trong bối cảnh.
- **Nâng cao chất lượng câu từ**: Hướng dẫn AI chau chuốt từ ngữ, làm giàu hình ảnh văn học tiếng Việt, loại bỏ lỗi cấu trúc câu bị động hoặc bị ảnh hưởng bởi ngữ pháp tiếng Trung.

Kết quả trả về chỉ gồm System Prompt biên tập tiếng Việt đặt trong khối code markdown \`\`\`. Không ghi thêm lời giải thích nào khác.`;
    }

    if (mode === "model2-prompt") {
      return `Bạn là chuyên gia thiết lập prompt phân tích thuật ngữ và trích xuất thực thể (Named Entity Recognition) Trung-Việt hàng đầu.
Hãy đọc kỹ mẫu văn bản từ 10 chương đầu của bộ truyện này để biên soạn một System Prompt quét từ điển cực kỳ chuẩn xác cho Model 2.

System Prompt dành cho Model 2 cần hướng dẫn AI cách quét và trích xuất từ điển theo các tiêu chuẩn sau:
1. **Phạm vi trích xuất**:
   - Tên nhân vật (nhân vật chính, phụ, các danh xưng đặc thù).
   - Địa danh (tông môn, thành trì, bí cảnh, núi sông bối cảnh truyện).
   - Thuật ngữ đặc trưng (linh dược, yêu thú, vũ khí, võ học, cảnh giới tu luyện).
2. **Quy tắc phiên âm & dịch nghĩa**:
   - Dịch nghĩa hoặc phiên âm Hán-Việt chuẩn xác, hợp ngữ cảnh thể loại của truyện này (ví dụ: Tiên Hiệp cần phiên âm cổ phong, Đô Thị cần dịch thuần Việt tự nhiên).
   - Chỉ ra cách xử lý các từ Hán-Việt đa nghĩa, các từ ghép hoặc ẩn dụ tác giả thường dùng.
3. **Quy tắc lọc nhiễu**:
   - Tuyệt đối loại bỏ các đại từ nhân xưng thông thường (ta, hắn, ngươi, bọn họ) và các trạng từ, từ nối phổ biến.
   - Tránh trích xuất trùng lặp các thực thể đã quá rõ ràng.

Yêu cầu đầu ra: Trả về kết quả chỉ gồm duy nhất đoạn System Prompt quét từ điển bằng tiếng Việt đặt trong khối code markdown \`\`\`. Tuyệt đối không thêm lời dẫn luận hay giải thích ngoài khối code.`;
    }

    if (mode === "model3-prompt") {
      return `Bạn là chuyên gia biên kịch, kiểm định dịch thuật và hiệu đính văn học Trung-Việt chuyên nghiệp.
Hãy đọc mẫu truyện để thiết lập một System Prompt tối ưu nhất cho Model 3 (QA Bot - Giám sát & Tinh chỉnh nâng cao).

System Prompt dành cho Model 3 cần hướng dẫn QA Bot thực hiện quy trình audit và tinh chỉnh theo các tiêu chuẩn sau:
1. **Rà soát & Sửa lỗi dịch thuật**:
   - Phát hiện các lỗi ngữ pháp tiếng Việt, câu cú lủng củng, lặp từ hoặc hành văn bị ảnh hưởng bởi cấu trúc ngữ pháp tiếng Trung (Word-by-Word translation).
   - Đối chiếu quy tắc xưng hô để đảm bảo tính nhất quán giữa các phân đoạn hội thoại.
2. **Làm mịn & Nâng cao văn phong**:
   - Chau chuốt câu từ để đạt độ mượt mà văn học tối đa, nhịp điệu trôi chảy, thuần Việt nhưng vẫn giữ trọn không khí bối cảnh gốc của tác giả.
   - Tối ưu hóa các cụm từ ẩn dụ, thành ngữ Trung Quốc sang các cách diễn đạt tương đương, dễ hiểu và giàu hình ảnh trong tiếng Việt.
3. **Giữ nguyên cốt truyện & cấu trúc**:
   - Tuyệt đối không được tóm tắt, cắt xén nội dung, hoặc tự ý sáng tác thêm tình tiết mới.
   - Giữ nguyên các tag phân đoạn, giữ nguyên cấu trúc định dạng nguyên tác.

Yêu cầu đầu ra: Trả về kết quả chỉ gồm duy nhất đoạn System Prompt QA Bot bằng tiếng Việt đặt trong khối code markdown \`\`\`. Tuyệt đối không thêm lời dẫn luận hay giải thích ngoài khối code.`;
    }

    return `Bạn là chuyên gia phân tích và dịch thuật tiểu thuyết Trung-Việt chuyên nghiệp.
Hãy phân tích mẫu truyện và sinh ra một System Prompt ngắn gọn, đúng trọng tâm để hướng dẫn AI dịch trực tiếp từ tiếng Trung sang tiếng Việt.

System Prompt được sinh phải đáp ứng các yêu cầu sau:
- Dịch đúng thể loại (Tiên Hiệp, Đô Thị, Hệ Thống, v.v.), phong cách viết của tác giả.
- Dịch đúng ngữ cảnh và tên riêng nhân vật / địa danh / chiêu thức.
- Quy định hành văn ổn định sát truyện, xưng hô chuẩn xác giữa các nhân vật.
- Dịch sát nghĩa gốc, tuyệt đối không được tự ý thêm bớt nội dung khi dịch.
- Viết ngắn gọn, chuẩn xác, không quá dài dòng cũng không quá sơ sài.
- **Giữ phong vị truyện (Tránh thuần Việt quá mức)**: Dịch thoát ý tự nhiên, trôi chảy chuẩn ngữ pháp tiếng Việt, nhưng tuyệt đối không thuần Việt hóa quá đà làm mất đi phong vị đặc trưng của truyện bối cảnh mạng Trung Quốc. Giữ lại các thuật ngữ Hán-Việt quen thuộc (như linh khí, tông môn, võ học, đan điền, ngự kiếm, thần thông).

Kết quả trả về chỉ gồm System Prompt bằng tiếng Việt đặt trong khối code markdown \`\`\`. Không ghi thêm lời giải thích nào khác.`;
  }, [mode]);

  const handleProviderChange = async (providerId: string) => {
    await db.novels.update(novelId, {
      customTranslateProviderId: providerId,
      customTranslateModelId: "",
    });
  };
  const handleModelChange = async (modelId: string) => {
    if (!selectedProviderId) return;
    await db.novels.update(novelId, {
      customTranslateModelId: modelId,
    });
  };

  useEffect(() => {
    if (open && novel) {
      const dbPrompt = (novel as any)[promptField] || "";
      setGeneratedPrompt(dbPrompt);
    }
  }, [open, novelId, promptField]);

  const resolveModel = useCallback(async () => {
    let activeModel = novel?.customTranslateProviderId
      ? { providerId: novel.customTranslateProviderId, modelId: novel.customTranslateModelId || "" }
      : settings.translateModel;

    // Ưu tiên tuyệt đối dùng Admin Model nếu còn lượt
    if (displayQuota > 0) {
      activeModel = { providerId: "admin-provider", modelId: "admin-model" };
    }

    const model = await resolveChapterToolModel(
      activeModel,
      defaultProvider,
      chatSettings,
    );

    if (!model && displayQuota > 0) {
      return await resolveChapterToolModel(
        { providerId: "admin-provider", modelId: "admin-model" },
        defaultProvider,
        chatSettings
      );
    }

    if (!model) {
      toast.error(getChapterToolModelMissingMessage(defaultProvider));
    }
    return model;
  }, [novel?.customTranslateProviderId, novel?.customTranslateModelId, settings.translateModel, defaultProvider, chatSettings, displayQuota]);

  const handleScan = async () => {
    const model = await resolveModel();
    if (!model) return;

    setIsScanning(true);
    try {
      // 1. Fetch up to 10 chapters
      const chapters = await db.chapters
        .where("novelId")
        .equals(novelId)
        .sortBy("order");

      const firstChapters = chapters.slice(0, 10);
      if (firstChapters.length === 0) {
        throw new Error("Truyện chưa có chương nào.");
      }

      const chapterIds = new Set(firstChapters.map((c) => c.id));
      const allScenes = await db.scenes
        .where("[novelId+isActive]")
        .equals([novelId, 1])
        .toArray();

      const scenesByChapter = new Map<string, typeof allScenes>();
      for (const s of allScenes) {
        if (!chapterIds.has(s.chapterId)) continue;
        const arr = scenesByChapter.get(s.chapterId) ?? [];
        arr.push(s);
        scenesByChapter.set(s.chapterId, arr);
      }
      for (const scenes of scenesByChapter.values()) {
        scenes.sort((a, b) => a.order - b.order);
      }

      const parts: string[] = [];
      for (const chapter of firstChapters) {
        const scenes = scenesByChapter.get(chapter.id) ?? [];
        if (scenes.length === 0) continue;
        const contents = await Promise.all(scenes.map((s) => getOriginalContent(s.id)));
        const content = contents.join("\n\n");
        if (!content.trim()) continue;
        // Limit each chapter to 1000 chars to save context
        parts.push(content.slice(0, 1000));
      }

      const sampleText = parts.join("\n---\n");

      // 2. Run AI
      const result = await streamText({
        model,
        system: initialPromptText,
        prompt: "MẪU VĂN BẢN TỪ TRUYỆN:\n" + sampleText,
      });

      let fullText = "";
      for await (const chunk of result.textStream) {
        fullText += chunk;
      }

      if (!fullText.trim()) {
        throw new Error("Không nhận được phản hồi từ AI (kết quả rỗng). Vui lòng kiểm tra lại cấu hình API Key, kết nối mạng, hoặc thử model khác.");
      }

      setGeneratedPrompt(fullText);
      toast.success("Đã phân tích xong!");
    } catch (err: any) {
      toast.error("Lỗi khi tạo prompt: " + err.message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRefine = async () => {
    if (!feedback.trim() || !generatedPrompt.trim()) return;

    const model = await resolveModel();
    if (!model) return;

    setIsRefining(true);
    try {
      const refinePrompt = `Đây là kết quả phân tích và System Prompt hiện tại của bạn:
${generatedPrompt}

Người dùng có góp ý sau để điều chỉnh:
"${feedback}"

Vui lòng cập nhật lại kết quả phân tích và System Prompt dựa trên góp ý này. Đảm bảo System Prompt vẫn được đặt trong khối code markdown \`\`\`.`;

      const result = await streamText({
        model,
        prompt: refinePrompt,
      });

      let fullText = "";
      for await (const chunk of result.textStream) {
        fullText += chunk;
      }

      if (!fullText.trim()) {
        throw new Error("Không nhận được phản hồi từ AI khi điều chỉnh (kết quả rỗng). Vui lòng thử lại.");
      }

      setGeneratedPrompt(fullText);
      setFeedback("");
      toast.success("Đã cập nhật prompt!");
    } catch (err: any) {
      toast.error("Lỗi khi điều chỉnh prompt: " + err.message);
    } finally {
      setIsRefining(false);
    }
  };

  const handleSave = async () => {
    if (!generatedPrompt.trim()) return;

    // Attempt to extract just the code block if it exists
    let promptToSave = generatedPrompt;
    const match = generatedPrompt.match(/\`\`\`[\s\S]*?\n([\s\S]+?)\`\`\`/);
    if (match && match[1]) {
      promptToSave = match[1].trim();
    }

    const updateObj: any = {
      styleScannedAt: new Date(),
      updatedAt: new Date(),
    };
    updateObj[promptField] = promptToSave;

    await db.novels.update(novelId, updateObj);

    toast.success("Đã lưu Prompt vào hệ thống!");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-blue-500" />
            {mode === "edit" ? "Tạo Prompt Biên Tập Chuyên Biệt" : 
             mode === "model2-prompt" ? "Tạo Prompt Quét Từ Điển" :
             mode === "model3-prompt" ? "Tạo Prompt QA Bot (Giám sát & Tinh chỉnh)" :
             "Tạo Prompt Dịch Chuyên Biệt"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "AI sẽ quét 10 chương đầu của truyện để phân tích văn phong tiếng Việt và đưa ra System Prompt biên tập tối ưu nhất cho riêng bộ truyện này."
              : mode === "model2-prompt"
              ? "AI sẽ quét 10 chương đầu của truyện để tạo ra một System Prompt tối ưu hỗ trợ trích xuất và chuẩn hóa từ điển cho riêng bộ truyện này."
              : mode === "model3-prompt"
              ? "AI sẽ quét 10 chương đầu của truyện để tạo ra một System Prompt giúp QA Bot rà soát lỗi và nâng cao độ mượt mà cho bản dịch."
              : "AI sẽ quét 10 chương đầu của truyện để phân tích văn phong, xưng hô và đưa ra System Prompt tối ưu nhất cho riêng bộ truyện này."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2 flex-1 min-h-0">
          {displayQuota > 0 ? (
            <div className="flex items-center justify-center p-2 rounded-lg border border-blue-500/30 bg-blue-500/10">
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                <SparklesIcon className="size-4" />
                Hệ thống tự động sử dụng {displayQuota} lượt dịch Admin miễn phí
              </span>
            </div>
          ) : (
            <div className="flex gap-2 items-center shrink-0">
              <Label className="text-xs whitespace-nowrap text-muted-foreground font-medium">Sử dụng AI:</Label>
              <Select value={selectedProviderId} onValueChange={handleProviderChange}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue placeholder="Chọn Provider..." />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={currentModel?.modelId ?? ""}
                onValueChange={handleModelChange}
                disabled={!selectedProviderId}
              >
                <SelectTrigger className="flex-1 h-8 text-xs">
                  <SelectValue placeholder="Chọn Model..." />
                </SelectTrigger>
                <SelectContent>
                  {models?.map((m) => (
                    <SelectItem key={m.id} value={m.modelId}>
                      {m.name || m.modelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!generatedPrompt && !isScanning ? (
            <div className="flex flex-col items-center justify-center py-10 gap-4 border border-dashed rounded-lg bg-muted/30">
              <SparklesIcon className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Chưa có prompt nào được tạo cho truyện này.</p>
              <Button onClick={handleScan} className="gap-2">
                <SparklesIcon className="size-4" /> Bắt đầu quét & tạo Prompt
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Kết quả từ AI:</span>
                <Button variant="outline" size="sm" onClick={handleScan} disabled={isScanning} className="gap-2 h-8">
                  {isScanning ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
                  Quét lại từ đầu
                </Button>
              </div>

              <Textarea
                value={generatedPrompt}
                onChange={(e) => setGeneratedPrompt(e.target.value)}
                disabled={isScanning || isRefining}
                className="flex-1 min-h-[300px] text-[12px] font-mono leading-relaxed"
                placeholder={isScanning ? "Đang phân tích..." : "Kết quả AI sẽ hiện ở đây..."}
              />

              <div className="space-y-2 pt-2 border-t mt-2">
                <span className="text-sm font-medium block">Góp ý điều chỉnh (Iteration):</span>
                <div className="flex gap-2">
                  <Textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    disabled={isScanning || isRefining || !generatedPrompt}
                    placeholder="VD: Đổi xưng hô nam chính thành bổn tọa, phong cách hài hước hơn..."
                    className="h-16 text-sm resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleRefine();
                      }
                    }}
                  />
                  <Button
                    onClick={handleRefine}
                    disabled={isScanning || isRefining || !feedback.trim() || !generatedPrompt}
                    className="h-16 shrink-0 gap-2 w-28"
                  >
                    {isRefining ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                    Tối ưu lại
                  </Button>
                </div>
              </div>

              <Button onClick={handleSave} className="w-full gap-2 mt-2" disabled={isScanning || isRefining || !generatedPrompt}>
                <CheckIcon className="size-4" />
                Lưu Prompt Này Cho Truyện
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
