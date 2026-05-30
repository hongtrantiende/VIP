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

const PROMPT_JSON_TEMPLATE = `{
  "The_Loai": "Thể loại chính, phụ, các nhãn đặc trưng của truyện (Ví dụ: Tiên hiệp, Đô thị, Võng du, Đồng nhân, Sắc hiệp 18+...)",
  "Boi_Canh": "Mô tả bối cảnh không gian thời gian (Ví dụ: Nhật Bản hiện đại đan xen yếu tố tu chân võ học...)",
  "Quy_Tac_Dich_Ten_Nhan_Vat": "Quy định rõ cách dịch tên nhân vật phù hợp bối cảnh (Ví dụ: Bối cảnh Nhật dùng Romaji, Âu Mỹ giữ Latin, Tiên hiệp dùng Hán-Việt chuẩn...)",
  "Quy_Tac_Dich_Ten_Ky_Nang": "Quy tắc dịch võ học, phép thuật, công pháp hệ thống (Ví dụ: Dùng Hán-Việt ngầu lòi phong cách võng văn...)",
  "Quy_Tac_Dich_Ten_Dia_Danh": "Quy tắc dịch địa danh, thành phố, trường học (Ví dụ: Dùng Romaji cho bối cảnh Nhật Bản...)",
  "Quy_Tac_Dich_Ten_Vat_Pham": "Quy tắc dịch bảo pháp, vũ khí, thần binh, đạo cụ hệ thống (Ví dụ: Dùng Hán-Việt võng văn...)",
  "Quy_Tac_Dich_Ten_Su_Kien": "Quy tắc dịch sự kiện ca nhạc, chương trình TV, giải thưởng (Ví dụ: Giữ tiếng Anh/Latin chuẩn quốc tế...)",
  "Khi_Chat_Van_Phong": "Giọng điệu hành văn tổng thể (Ví dụ: Nam tính, bá đạo, thực dụng; sắc bén khi phá án; sắc tình mờ ám khi tương tác nữ giới...)",
  "Xung_Ho_Cot_Loi": "Đại từ nhân xưng cốt lõi giữa các cặp nhân vật chính (Ví dụ: Kogoro tự xưng ta/tôi, ba - con với Ran, ta - ký chủ với Hệ thống...)",
  "Quy_Tac_Khuyen_Khich": "Các thuật ngữ, cụm từ ngữ cảnh khuyến khích giữ nguyên Hán-Việt quen thuộc (Ví dụ: Hệ thống, Ký chủ, Độ thiện cảm...)",
  "Quy_Tac_Nghiem_Cam": "Các từ ngữ, hành vi tuyệt đối nghiêm cấm (Ví dụ: Tuyệt đối không dùng Hán-Việt cho tên Nhật, không kiểm duyệt hay cắt bớt cảnh nóng 18+...)"
}`;

const PROMPT_CONAN_EXAMPLE = `{
  "The_Loai": "Đồng nhân Anime (Detective Conan), Xuyên không, Hệ thống, Trinh thám, Sắc hiệp (18+), Harem, Hài hước.",
  "Boi_Canh": "Nhật Bản hiện đại, có đan xen yếu tố Hệ thống, Tu chân, Võ học.",
  "Quy_Tac_Dich_Ten_Nhan_Vat": "Bối cảnh Nhật: BẮT BUỘC dùng Romaji (Mouri Kogoro, Ran, Okino Yoko, Ikezawa Yuko, Kudo Shinichi, Megure). Bối cảnh Âu Mỹ: Giữ nguyên/Latin (Mary, Peter). Bối cảnh Tiên hiệp: Hán-Việt.",
  "Quy_Tac_Dich_Ten_Ky_Nang": "BẮT BUỘC dùng Hán-Việt ngầu lòi cho võ học, hệ thống (VD: Dịch Cân Tẩy Tủy, Không thủ đạo, Trận pháp).",
  "Quy_Tac_Dich_Ten_Dia_Danh": "Bối cảnh Nhật Bản: BẮT BUỘC dùng Romaji (VD: Beika, Teitan).",
  "Quy_Tac_Dich_Ten_Vat_Pham": "BẮT BUỘC dùng Hán-Việt mang phong cách võng văn (VD: Huyễn Giác Tạp).",
  "Quy_Tac_Dich_Ten_Su_Kien": "Chương trình TV, Giải thưởng, Thương hiệu thực tế BẮT BUỘC dùng Tiếng Anh / Tên Quốc Tế (VD: Golden Music Festival).",
  "Khi_Chat_Van_Phong": "Nam tính, bá đạo, thực dụng. Lúc phá án: sắc bén, chuyên nghiệp. Lúc tương tác nữ giới: chiếm hữu, mờ ám/sắc tình (miêu tả hình thể hấp dẫn nhưng không thô tục rẻ tiền). Nội tâm: hài hước, tự trào.",
  "Xung_Ho_Cot_Loi": "Kogoro nội tâm (tôi/ta). Kogoro với Hệ thống (ta - cô/ngươi, HT gọi 'Ký chủ'). Kogoro với Ran (Ba/bố - con). Kogoro với Conan (Chú/ta - nhóc/cháu). Kogoro với nữ giới (Bình thường: Tôi - cô; Khi thân mật/cưỡng ép/18+: Anh - em/cô).",
  "Quy_Tac_Khuyen_Khich": "Dịch sát nghĩa gốc. Bắt buộc giữ lại thuật ngữ Hán-Việt quen thuộc (Hệ thống, Ký chủ, Độ thiện cảm).",
  "Quy_Tac_Nghiem_Cam": "TUYỆT ĐỐI KHÔNG dùng Hán-Việt cho tên/địa danh Nhật (Cấm dùng Mao Lợi Tiểu Ngũ Lang, Mao Lợi Lan). KHÔNG thuần Việt hóa quá mức. TUYỆT ĐỐI KHÔNG tự ý thêm bớt tình tiết hay KIỂM DUYỆT (censor) nội dung của tác giả."
}`;

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
  const [isDetailedScanning, setIsDetailedScanning] = useState(false);
  const [detailedScanProgress, setDetailedScanProgress] = useState("");
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

System Prompt dành cho Model 2 cần hướng dẫn AI cách quét, trích xuất và phân loại từ điển theo các tiêu chuẩn sau:
1. **Phạm vi trích xuất & Phân loại bắt buộc (dictType)**:
   - Hướng dẫn AI bắt buộc phân loại các thực thể trích xuất được thành đúng 3 nhóm để lưu trữ:
     + 'names': Tên nhân vật (chính, phụ, các danh xưng riêng biệt), Địa danh (thành trì, bí cảnh, núi sông, tông môn, bang hội).
     + 'tuvung': Vật phẩm (vũ khí, thần binh, linh dược, đạo cụ), Kỹ năng (võ học, công pháp, bí tịch, thần thông), Thuật ngữ (cảnh giới tu luyện, hiệu ứng hệ thống).
     + 'ngucanh': Thành ngữ, cụm từ ngữ cảnh đặc trưng hoặc cách nói đặc sắc.
2. **Quy tắc phiên âm & dịch nghĩa**:
   - Dịch nghĩa hoặc phiên âm Hán-Việt chuẩn xác, hợp ngữ cảnh thể loại của truyện này (ví dụ: Tiên Hiệp cần phiên âm cổ phong, Đô Thị cần dịch thuần Việt tự nhiên).
   - **Đặc biệt lưu ý với tên người/địa danh Nhật Bản**: Tuyệt đối KHÔNG dùng Hán-Việt (không dịch thành Công Đằng Tân Nhất, Mễ Hoa đinh...) mà BẮT BUỘC phải dùng tên phiên âm Romaji chuẩn (ví dụ: Kudo Shinichi, Beika...). System Prompt sinh ra phải nhấn mạnh quy tắc này nếu truyện thuộc bối cảnh Nhật Bản hoặc Đồng nhân.
   - Chỉ ra cách xử lý các từ Hán-Việt đa nghĩa, các từ ghép hoặc ẩn dụ tác giả thường dùng.
3. **Quy tắc lọc nhiễu**:
   - Tuyệt đối loại bỏ các đại từ nhân xưng thông thường (ta, hắn, ngươi, bọn họ) và các trạng từ, từ nối phổ biến.
   - Tránh trích xuất trùng lặp các thực thể đã quá rõ ràng.

Cơ chế sinh Prompt BẮT BUỘC phải dựa theo cấu trúc JSON mẫu sau để phân tích từ vựng và đại từ:
${PROMPT_JSON_TEMPLATE}

Ví dụ mẫu điền dữ liệu chuẩn bạn cần tham khảo (Few-shot example):
${PROMPT_CONAN_EXAMPLE}

Yêu cầu đầu ra: Trả về kết quả là một đối tượng JSON phân tích từ điển bằng tiếng Việt khớp hoàn toàn với cấu trúc JSON mẫu trên, đặt trong khối code markdown \`\`\`json ... \`\`\`. Tuyệt đối không thêm lời dẫn luận hay giải thích ngoài khối code.`;
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
- **Tự động phân tích bối cảnh truyện và chỉ định quy tắc dịch tên nhân vật/địa danh phù hợp nhất**:
  + Nếu phát hiện bối cảnh Nhật Bản/Anime: Bắt buộc yêu cầu AI dịch tên nhân vật sang chuẩn Romaji (Ví dụ: Mouri Kogoro, Kudo Shinichi, TUYỆT ĐỐI KHÔNG dùng Hán-Việt như Mao Lợi Tiểu Ngũ Lang).
  + Nếu phát hiện bối cảnh Âu Mỹ/Phương Tây: Bắt buộc yêu cầu AI giữ nguyên tên gốc hoặc phiên âm Latin phổ biến (Ví dụ: Peter, Mary, TUYỆT ĐỐI KHÔNG dùng Hán-Việt cổ như Bỉ Đắc, Mã Lệ).
  + If phát hiện bối cảnh Trung Quốc cổ trang/Tiên Hiệp: Bắt buộc yêu cầu AI dịch tên nhân vật sang phiên âm Hán-Việt chuẩn và viết hoa đẹp đẽ (Ví dụ: Tô Dật, Tiêu Viêm).
- Dịch đúng ngữ cảnh và tên riêng nhân vật / địa danh / chiêu thức.
- Quy định hành văn ổn định sát truyện, xưng hô chuẩn xác giữa các nhân vật.
- Dịch sát nghĩa gốc, tuyệt đối không được tự ý thêm bớt nội dung khi dịch.
- Viết ngắn gọn, chuẩn xác, không quá dài dòng cũng không quá sơ sài.
- **Giữ phong vị truyện (Tránh thuần Việt quá mức)**: Dịch thoát ý tự nhiên, trôi chảy chuẩn ngữ pháp tiếng Việt, nhưng tuyệt đối không thuần Việt hóa quá đà làm mất đi phong vị đặc trưng của truyện bối cảnh mạng Trung Quốc. Giữ lại các thuật ngữ Hán-Việt quen thuộc (như linh khí, tông môn, võ học, đan điền, ngự kiếm, thần thông).

Bạn BẮT BUỘC phải sinh ra System Prompt dịch dưới dạng một đối tượng JSON khớp hoàn hảo với cấu trúc JSON mẫu dưới đây:
${PROMPT_JSON_TEMPLATE}

Ví dụ mẫu điền dữ liệu chuẩn bạn cần tham khảo (Few-shot example):
${PROMPT_CONAN_EXAMPLE}

Yêu cầu đầu ra: Trả về kết quả là một đối tượng JSON phân tích văn phong dịch bằng tiếng Việt khớp hoàn toàn với cấu trúc JSON mẫu trên, đặt trong khối code markdown \`\`\`json ... \`\`\`. Tuyệt đối không thêm lời dẫn luận hay giải thích ngoài khối code.`;
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

  const handleDetailedScan = async () => {
    const model = await resolveModel();
    if (!model) return;

    setIsDetailedScanning(true);
    setDetailedScanProgress("Đang tải danh sách chương...");
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

      const chapterAnalyses: string[] = [];

      // 2. Scan chapter-by-chapter
      const { generateText } = await import("ai");
      for (let i = 0; i < firstChapters.length; i++) {
        const chapter = firstChapters[i];
        setDetailedScanProgress(`Đang quét chi tiết chương ${i + 1}/${firstChapters.length}: ${chapter.title}...`);

        const scenes = scenesByChapter.get(chapter.id) ?? [];
        if (scenes.length === 0) continue;
        const contents = await Promise.all(scenes.map((s) => getOriginalContent(s.id)));
        const content = contents.join("\n\n");
        if (!content.trim()) continue;

        // Take up to 2000 characters from each chapter for detailed analysis
        const sampleText = content.slice(0, 2000);

        const analyzeSystemPrompt = `Bạn là trợ lý phân tích văn chương chuyên nghiệp.
Nhiệm vụ: Hãy phân tích kỹ đoạn chương truyện ${i + 1} (${chapter.title}) sau để trích xuất các thông tin phục vụ dịch thuật/biên tập.
Phân tích và ghi lại ngắn gọn (dưới 200 từ):
1. Thể loại, giọng điệu, nhịp điệu hành văn nổi bật của chương này.
2. Tên các nhân vật xuất hiện, mối quan hệ và cách xưng xưng hô thực tế giữa họ trong đối thoại.
3. Các từ ngữ Hán-Việt đặc thù, tên môn phái, võ công hoặc chi tiết bối cảnh đặc thù cần lưu tâm.
Hãy trả về tiếng Việt ngắn gọn, đi thẳng vào ý chính.`;

        const res = await generateText({
          model,
          system: analyzeSystemPrompt,
          prompt: sampleText,
        });

        const analysisText = res.text?.trim() || "";
        if (analysisText) {
          chapterAnalyses.push(`Chương ${i + 1}: ${chapter.title}\n${analysisText}`);
        }
      }

      if (chapterAnalyses.length === 0) {
        throw new Error("Không có nội dung chương nào để phân tích.");
      }

      // 3. Combine and generate final prompt (stream final result)
      setDetailedScanProgress("Đang tổng hợp kết quả của tất cả các chương để sinh Prompt dịch chuẩn...");

      const mergePrompt = `Dưới đây là kết quả phân tích chi tiết của ${chapterAnalyses.length} chương đầu tiên của truyện:
=========================================
${chapterAnalyses.join("\n\n=========================================\n\n")}
=========================================

Dựa trên kết quả phân tích chi tiết từng chương ở trên, hãy thực hiện nhiệm vụ tổng hợp và sinh ra một System Prompt hoàn chỉnh và tối ưu nhất cho truyện theo đúng các yêu cầu được quy định.`;

      const result = await streamText({
        model,
        system: initialPromptText,
        prompt: mergePrompt,
      });

      let fullText = "";
      for await (const chunk of result.textStream) {
        fullText += chunk;
        setGeneratedPrompt(fullText);
      }

      if (!fullText.trim()) {
        throw new Error("Không nhận được phản hồi tổng hợp từ AI.");
      }

      toast.success("Đã hoàn thành quét chi tiết!");
    } catch (err: any) {
      toast.error("Lỗi quét chi tiết: " + err.message);
    } finally {
      setIsDetailedScanning(false);
      setDetailedScanProgress("");
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

          {!generatedPrompt && !isScanning && !isDetailedScanning ? (
            <div className="flex flex-col items-center justify-center py-10 gap-4 border border-dashed rounded-lg bg-muted/30">
              <SparklesIcon className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Chưa có prompt nào được tạo cho truyện này.</p>
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md px-4">
                <Button onClick={handleScan} className="gap-2 flex-1">
                  <SparklesIcon className="size-4" /> Quét nhanh (1 lần)
                </Button>
                <Button onClick={handleDetailedScan} variant="outline" className="gap-2 flex-1 border-blue-500/30 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50">
                  <RefreshCwIcon className="size-4" /> Quét chi tiết (10 chương)
                </Button>
              </div>
            </div>
          ) : (isScanning || isDetailedScanning) && !generatedPrompt ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed rounded-lg bg-muted/30">
              <Loader2Icon className="size-10 text-blue-500 animate-spin" />
              <p className="text-sm font-medium text-center text-blue-600 dark:text-blue-400 px-6 max-w-md">
                {isDetailedScanning ? detailedScanProgress : "Đang quét bối cảnh truyện..."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {isDetailedScanning ? (
                    <span className="text-blue-600 flex items-center gap-1.5 animate-pulse text-xs font-semibold">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      {detailedScanProgress}
                    </span>
                  ) : "Kết quả từ AI:"}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleScan} disabled={isScanning || isDetailedScanning} className="gap-2 h-8 text-xs">
                    {isScanning ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
                    Quét nhanh lại
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDetailedScan} disabled={isScanning || isDetailedScanning} className="gap-2 h-8 text-xs border-blue-500/20 text-blue-600 hover:text-blue-700 hover:bg-blue-50/30">
                    {isDetailedScanning ? <Loader2Icon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5" />}
                    Quét chi tiết lại
                  </Button>
                </div>
              </div>

              <Textarea
                value={generatedPrompt}
                onChange={(e) => setGeneratedPrompt(e.target.value)}
                disabled={isScanning || isDetailedScanning || isRefining}
                className="flex-1 min-h-[300px] text-[12px] font-mono leading-relaxed"
                placeholder="Kết quả AI sẽ hiện ở đây..."
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
