"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditableText } from "@/components/novel/editable-text";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getOrCreateWritingSettings,
  updateNovel,
  useChapterPlans,
  useChapters,
  useCharacters,
  useNovel,
  usePlotArcs,
} from "@/lib/hooks";
import type { WritingAgentRole, WritingSettings } from "@/lib/db";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  generateChapterPlans,
  generateCharacters,
  generatePlotArcs,
  generateWorldBuilding,
  saveChapterPlans,
  saveCharacters,
  savePlotArcs,
  saveWorldBuilding,
} from "@/lib/writing/auto-generate";
import { createChapterPlan } from "@/lib/hooks/use-chapter-plans";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  GlobeIcon,
  Loader2Icon,
  MapIcon,
  MapPinIcon,
  PenIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PipelineStepConfig } from "./pipeline-step-config";
import type { IdeaFormData } from "./idea-form";
import { useWritingPipelineStore } from "@/lib/stores/writing-pipeline";
import { Textarea } from "@/components/ui/textarea";
import { generateStructured } from "@/lib/ai/structured";
import { withGlobalInstruction } from "@/lib/ai/system-prompt";
import { resolveStep } from "@/lib/ai/resolve-step";
import { jsonSchema } from "ai";
import {
  getDefaultSetupPrompt,
  SETUP_PROMPT_KEYS,
  type SetupStep,
} from "@/lib/writing/auto-generate-prompts";

/** Model configs still reuse pipeline roles for model selection */
const SETUP_MODEL_ROLES: Record<SetupStep, WritingAgentRole> = {
  world: "context",
  characters: "direction",
  arcs: "outline",
  plans: "writer",
};

const STEPS: {
  key: SetupStep;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    key: "world",
    label: "Thế giới quan",
    description: "Xây dựng bối cảnh, thế lực, địa danh và quy tắc",
    icon: GlobeIcon,
  },
  {
    key: "characters",
    label: "Nhân vật",
    description: "Tạo nhân vật với tính cách, động lực và mục tiêu",
    icon: UsersIcon,
  },
  {
    key: "arcs",
    label: "Hướng đi nhân vật",
    description: "Thiết lập lộ trình phát triển và các mạch hành trình tuần tự của nhân vật chính",
    icon: MapIcon,
  },
  {
    key: "plans",
    label: "Kế hoạch chương",
    description: "Lên kế hoạch cho các chương đầu tiên",
    icon: BookOpenIcon,
  },
];

// ─── Main Component ─────────────────────────────────────────

export function SetupWizard({
  novelId,
  ideaData,
  onCompleteAction,
  startAtStep,
}: {
  novelId: string;
  ideaData: IdeaFormData;
  onCompleteAction: () => void;
  startAtStep?: SetupStep;
}) {
  const [currentStep, setCurrentStep] = useState<SetupStep>(
    startAtStep ?? "world",
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [wantsRegenerate, setWantsRegenerate] = useState(false);
  const [showSupplement, setShowSupplement] = useState(false);
  const [supplementIdea, setSupplementIdea] = useState("");
  const [isSupplementing, setIsSupplementing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const supplementAbortRef = useRef<AbortController | null>(null);
  const setStepUserInstruction = useWritingPipelineStore(
    (s) => s.setStepUserInstruction,
  );

  const novel = useNovel(novelId);
  const chapters = useChapters(novelId);
  const characters = useCharacters(novelId);
  const plotArcs = usePlotArcs(novelId);
  const chapterPlans = useChapterPlans(novelId);
  const [targetChapterCount, setTargetChapterCount] = useState<number>(50);
  const [targetParts, setTargetParts] = useState<number>(3);
  const [selectedPart, setSelectedPart] = useState<number>(1);
  const [isOpenEnded, setIsOpenEnded] = useState(false);
  const [isPartEnding, setIsPartEnding] = useState(false);

  // Tự động chia đều chương cho mỗi phần
  const chaptersPerPart = Math.ceil(targetChapterCount / targetParts);
  const getPartRange = (part: number) => {
    const start = (part - 1) * chaptersPerPart + 1;
    const end = Math.min(part * chaptersPerPart, targetChapterCount);
    return { start, end, count: end - start + 1 };
  };
  const getPartLabel = (part: number) => {
    const { start, end } = getPartRange(part);
    if (part === 1) return `Phần ${part}: Mở đầu (Ch.${start}-${end})`;
    if (part === targetParts) return `Phần ${part}: Kết thúc (Ch.${start}-${end})`;
    return `Phần ${part}: Phát triển (Ch.${start}-${end})`;
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);
  const stepDef = STEPS[currentStepIndex];

  useEffect(() => {
    void getOrCreateWritingSettings(novelId);
  }, [novelId]);

  // Load existing targetParts and targetChapterCount on mount
  useEffect(() => {
    if (novelId) {
      db.writingSettings.get(novelId).then((ws) => {
        if (ws) {
          // Type assertion to bypass strict TS check for custom fields
          const customWs = ws as any;
          if (customWs.targetChapterCount) setTargetChapterCount(customWs.targetChapterCount);
          if (customWs.targetParts) setTargetParts(customWs.targetParts);
          if (customWs.isPartEnding !== undefined) setIsPartEnding(customWs.isPartEnding);
          if (customWs.isOpenEnded !== undefined) setIsOpenEnded(customWs.isOpenEnded);
        }
      });
    }
  }, [novelId]);

  // Save targetParts and targetChapterCount when they change
  useEffect(() => {
    if (novelId) {
      void db.writingSettings.update(novelId, {
        targetParts,
        targetChapterCount,
        isPartEnding,
        isOpenEnded,
      } as any);
    }
  }, [novelId, targetParts, targetChapterCount, isPartEnding, isOpenEnded]);



  const wizardInstructionKey = `wizard:${currentStep}`;

  const isStepDone = useCallback(
    (step: SetupStep) => {
      switch (step) {
        case "world":
          return !!(novel?.worldOverview || novel?.factions?.length);
        case "characters":
          return (characters?.length ?? 0) > 0;
        case "arcs":
          return (plotArcs?.length ?? 0) > 0;
        case "plans":
          return (chapterPlans?.length ?? 0) > 0;
      }
    },
    [novel, characters, plotArcs, chapterPlans],
  );

  const stepDone = isStepDone(currentStep);

  const buildContext = useCallback(() => {
    const parts: string[] = [];
    if (novel?.worldOverview) parts.push(`Thế giới: ${novel.worldOverview}`);
    if (novel?.storySetting) parts.push(`Bối cảnh: ${novel.storySetting}`);
    if (novel?.powerSystem) parts.push(`Hệ thống sức mạnh: ${novel.powerSystem}`);
    if (novel?.factions?.length)
      parts.push(`Thế lực: ${novel.factions.map((f) => `${f.name}: ${f.description}`).join("\n")}`);
    if (novel?.keyLocations?.length)
      parts.push(`Địa danh: ${novel.keyLocations.map((l) => `${l.name}: ${l.description}`).join("\n")}`);
    
    if (characters?.length)
      parts.push(
        `Nhân vật: ${characters.map((c) => `${c.name} (${c.role}): ${c.description}`).join("\n")}`,
      );
    if (plotArcs?.length)
      parts.push(
        `Mạch truyện: ${plotArcs.map((a) => `${a.title} (${a.type}): ${a.description}`).join("\n")}`,
      );
    // Bao gồm cả chương đã viết để AI hiểu mạch truyện hiện tại
    if (chapters?.length)
      parts.push(
        `Chương đã viết (${chapters.length} chương):\n${chapters.map((ch) => `${ch.order}. ${ch.title}${ch.summary ? `: ${ch.summary}` : ""}`).join("\n")}`,
      );
    return parts.join("\n\n");
  }, [novel, characters, plotArcs, chapters, selectedPart]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const ws = await getOrCreateWritingSettings(novelId);
    const globalWs = await db.writingSettings.get("global-default");
    const promptKey = SETUP_PROMPT_KEYS[currentStep] as keyof WritingSettings;
    // Novel-specific → global default → undefined (lets auto-generate use hardcoded defaults)
    const systemPrompt =
      (ws[promptKey] as string | undefined) ??
      (globalWs?.[promptKey] as string | undefined) ??
      undefined;
    const userInstruction =
      useWritingPipelineStore.getState().stepUserInstructions[
        wizardInstructionKey
      ] ?? "";

    const options = {
      novelId,
      genre: ideaData.genre,
      setting: ideaData.setting,
      idea: ideaData.idea,
      style: ideaData.style,
      systemPrompt,
      userInstruction: userInstruction.trim() || undefined,
      abortSignal: controller.signal,
    };

    try {
      switch (currentStep) {
        case "world": {
          const result = await generateWorldBuilding(options);
          await saveWorldBuilding(novelId, result);
          break;
        }
        case "characters": {
          const result = await generateCharacters(options, buildContext());
          await saveCharacters(novelId, result);
          break;
        }
        case "arcs": {
          // Xây dựng prompt với thông tin phần/chương
          const partsInfo = Array.from({ length: targetParts }, (_, i) => {
            const p = i + 1;
            const { start, end } = getPartRange(p);
            const role = p === 1 ? "Mở đầu, giới thiệu thế giới & nhân vật" : p === targetParts ? "Cao trào & Kết thúc" : "Phát triển & Xung đột";
            return `- Phần ${p} (Ch.${start}-${end}): ${role}`;
          }).join("\n");

          const arcContext = buildContext() + (isOpenEnded
            ? `\n\nYÊU CẦU: Tạo mạch truyện cho PHẦN ${selectedPart} của truyện (khoảng ${chaptersPerPart} chương). ${isPartEnding ? "ĐÂY LÀ PHẦN KẾT THÚC của câu chuyện - mạch truyện phải giải quyết mọi xung đột cốt lõi và khép lại trọn vẹn." : "CHƯA KẾT THÚC - mạch truyện phải để ngỏ, tạo tiền đề để tiếp tục sang phần tiếp theo."} Tạo mạch chính, mạch phụ và mạch nhân vật. Các điểm mốc tập trung bám sát vào phần này.`
            : `\n\nYÊU CẦU: Tạo mạch truyện HOÀN CHỈNH cho truyện có ${targetChapterCount} chương, chia thành ${targetParts} phần:\n${partsInfo}\n\nMỗi mạch truyện phải đi từ BẮT ĐẦU (Phần 1) đến KẾT THÚC (Phần ${targetParts}). Mỗi điểm mốc (plot point) phải ghi rõ thuộc Phần nào và khoảng chương bao nhiêu. Tạo mạch chính, mạch phụ và mạch nhân vật. Các phần phải LIÊN KẾT chặt chẽ với nhau.`
          );
          const result = await generatePlotArcs(options, arcContext);
          await savePlotArcs(novelId, result);
          break;
        }
        case "plans": {
          // Tạo kế hoạch chương cho phần được chọn
          const { start, end, count } = getPartRange(selectedPart);
          const planPartsInfo = Array.from({ length: targetParts }, (_, i) => {
            const p = i + 1;
            const r = getPartRange(p);
            return `- Phần ${p} (Ch.${r.start}-${r.end})${p === selectedPart ? " ← ĐANG TẠO" : ""}`;
          }).join("\n");

          // Bao gồm kế hoạch phần trước (nếu có) để đảm bảo liên kết
          const existingPlansContext = chapterPlans?.length
            ? `\nKế hoạch chương đã có:\n${chapterPlans.map(p => `Ch.${p.chapterOrder}. ${p.title}: ${p.directions.join("; ")}`).join("\n")}`
            : "";
          const planContext = buildContext() + existingPlansContext + `\n\nCẤU TRÚC TRUYỆN (${targetChapterCount} chương, ${targetParts} phần):\n${planPartsInfo}\n\nYÊU CẦU: Tạo kế hoạch CHI TIẾT cho ${count} chương của Phần ${selectedPart} (từ chương ${start} đến chương ${end}).\n${selectedPart > 1 ? `Phần này phải TIẾP NỐI chặt chẽ từ phần trước.` : "Đây là phần MỞ ĐẦU của truyện."}\n${selectedPart < targetParts ? `Phần này phải CHUẨN BỊ cho phần tiếp theo.` : "Đây là phần KẾT THÚC, phải giải quyết mọi xung đột."}`;
          const result = await generateChapterPlans(options, planContext, count);
          // Gán đúng chapterOrder cho phần đang tạo
          result.plans = result.plans.map((p, i) => ({
            ...p,
            chapterOrder: start + i,
          }));
          await saveChapterPlans(novelId, result);
          break;
        }
      }
      setStepUserInstruction(wizardInstructionKey, "");
      setWantsRegenerate(false);
      toast.success(`Đã tạo ${stepDef.label}`);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setIsGenerating(false);
    }
  }, [
    currentStep,
    novelId,
    ideaData,
    buildContext,
    stepDef,
    wizardInstructionKey,
    setStepUserInstruction,
    targetChapterCount,
    targetParts,
    selectedPart,
    chapterPlans,
    isOpenEnded,
    isPartEnding,
    chaptersPerPart,
    getPartRange,
    getPartLabel,
  ]);

  const handleSkipPlans = useCallback(async () => {
    const existing = await db.chapterPlans
      .where("novelId")
      .equals(novelId)
      .count();
    if (existing > 0) return; // already have plans
    for (let i = 1; i <= 5; i++) {
      await createChapterPlan({
        novelId,
        chapterOrder: i,
        directions: [],
        outline: "",
        scenes: [],
        status: "planned",
      });
    }
    toast.success("Đã tạo 5 chương trống");
  }, [novelId]);

  const handleNext = useCallback(() => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentStepIndex + 1].key);
      setWantsRegenerate(false);
    } else {
      onCompleteAction();
    }
  }, [currentStepIndex, onCompleteAction]);

  // ── Supplement handler ─────────────────────────────────────

  const buildFullContext = useCallback(() => {
    const parts: string[] = [];
    if (novel?.worldOverview) parts.push(`[Tổng quan thế giới]\n${novel.worldOverview}`);
    if (novel?.storySetting) parts.push(`[Bối cảnh]\n${novel.storySetting}`);
    if (novel?.timePeriod) parts.push(`[Thời kỳ]\n${novel.timePeriod}`);
    if (novel?.powerSystem) parts.push(`[Hệ thống sức mạnh]\n${novel.powerSystem}`);
    if (novel?.factions?.length)
      parts.push(`[Thế lực]\n${novel.factions.map(f => `- ${f.name}: ${f.description}`).join("\n")}`);
    if (novel?.keyLocations?.length)
      parts.push(`[Địa danh]\n${novel.keyLocations.map(l => `- ${l.name}: ${l.description}`).join("\n")}`);
    
    // Bao gồm chương đã viết để AI hiểu mạch truyện tổng thể
    if (chapters?.length)
      parts.push(`[Chương đã viết - ${chapters.length} chương]\n${chapters.map(ch => `${ch.order}. ${ch.title}${ch.summary ? `: ${ch.summary}` : ""}`).join("\n")}`);
    if (characters?.length)
      parts.push(`[Nhân vật]\n${characters.map(c => `- ${c.name} (${c.role}): ${c.description}`).join("\n")}`);
    if (plotArcs?.length)
      parts.push(`[Mạch truyện]\n${plotArcs.map(a => `- ${a.title} (${a.type}): ${a.description}`).join("\n")}`);
    if (chapterPlans?.length)
      parts.push(`[Kế hoạch và Giàn ý chương]\n${chapterPlans.map(p => `${p.chapterOrder}. ${p.title ?? "Chưa đặt tên"}${p.outline ? ` - Giàn ý: ${p.outline}` : ""}`).join("\n")}`);
    return parts.join("\n\n");
  }, [novel, characters, plotArcs, chapterPlans, chapters, selectedPart]);

  const handleSupplement = useCallback(async () => {
    if (!supplementIdea.trim()) {
      toast.error("Vui lòng nhập ý tưởng bổ sung.");
      return;
    }
    setIsSupplementing(true);
    const controller = new AbortController();
    supplementAbortRef.current = controller;

    try {
      const ws = await getOrCreateWritingSettings(novelId);
      const roleKey = SETUP_MODEL_ROLES[currentStep];
      const stepConfig = ws[`${roleKey}Model` as keyof WritingSettings];
      let model;
      if (stepConfig) model = await resolveStep(stepConfig as any);
      if (!model) {
        const chatSettings = await db.chatSettings.get("default");
        if (chatSettings?.providerId && chatSettings?.modelId) {
          model = await resolveStep({ providerId: chatSettings.providerId, modelId: chatSettings.modelId });
        }
      }
      if (!model) throw new Error("Không tìm thấy mô hình AI.");

      const chatSettings = await db.chatSettings.get("default");
      const globalInstruction = chatSettings?.globalSystemInstruction;
      const fullContext = buildFullContext();

      switch (currentStep) {
        case "world": {
          const supplementSchema = jsonSchema<{
            worldOverview?: string;
            storySetting?: string;
            timePeriod?: string;
            powerSystem?: string;
            newFactions?: { name: string; description: string }[];
            newLocations?: { name: string; description: string }[];
          }>({
            type: "object",
            properties: {
              worldOverview: { type: "string", description: "Nội dung BỔ SUNG thêm cho tổng quan thế giới (chỉ phần mới, sẽ được nối vào cuối)" },
              storySetting: { type: "string", description: "Nội dung BỔ SUNG cho bối cảnh" },
              timePeriod: { type: "string", description: "Nội dung BỔ SUNG cho thời kỳ" },
              powerSystem: { type: "string", description: "Nội dung BỔ SUNG cho hệ thống sức mạnh" },
              newFactions: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] } },
              newLocations: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] } },
            },
          });
          const { object } = await generateStructured({
            model,
            schema: supplementSchema,
            system: withGlobalInstruction(
              `Bạn là nhà văn chuyên xây dựng thế giới truyện CHUYÊN SÂU. Nhiệm vụ: DỰA TRÊN ý tưởng bổ sung của người dùng, PHÂN TÍCH TOÀN BỘ dữ liệu hiện có (thế giới, nhân vật, mạch truyện, chương đã viết) rồi tạo NỘI DUNG MỚI TOÀN DIỆN để bổ sung. Bổ sung phải:
1. ĐỒNG NHẤT với mọi yếu tố hiện có (không mâu thuẫn)
2. LIÊN KẾT chặt chẽ với nhân vật, mạch truyện, chương đã viết
3. MỞ RỘNG thế giới theo hướng hợp lý
4. CHỈ trả về phần MỚI, KHÔNG lặp lại nội dung cũ
5. Nếu một trường không cần bổ sung theo ý tưởng, để trống.`,
              globalInstruction,
            ),
            prompt: `TOÀN BỘ DỮ LIỆU HIỆN CÓ (ĐỌC KỸ ĐỂ BỔ SUNG ĐỒNG NHẤT):\n${fullContext}\n\nÝ TƯỞNG BỔ SUNG CỦA NGƯỜI DÙNG:\n${supplementIdea}`,
            abortSignal: controller.signal,
          });
          // Merge: nối text fields, append list fields
          const updates: any = { updatedAt: new Date() };
          if (object.worldOverview?.trim()) updates.worldOverview = ((novel?.worldOverview ?? "") + "\n\n" + object.worldOverview).trim();
          if (object.storySetting?.trim()) updates.storySetting = ((novel?.storySetting ?? "") + "\n\n" + object.storySetting).trim();
          if (object.timePeriod?.trim()) updates.timePeriod = ((novel?.timePeriod ?? "") + " " + object.timePeriod).trim();
          if (object.powerSystem?.trim()) updates.powerSystem = ((novel?.powerSystem ?? "") + "\n\n" + object.powerSystem).trim();
          if (object.newFactions?.length) updates.factions = [...(novel?.factions ?? []), ...object.newFactions];
          if (object.newLocations?.length) updates.keyLocations = [...(novel?.keyLocations ?? []), ...object.newLocations];
          await db.novels.update(novelId, updates);
          break;
        }
        case "characters": {
          const charSchema = jsonSchema<{ characters: { name: string; role: string; description: string; personality: string; motivations: string; goals: string }[] }>({
            type: "object",
            properties: {
              characters: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, description: { type: "string" }, personality: { type: "string" }, motivations: { type: "string" }, goals: { type: "string" } }, required: ["name", "role", "description", "personality", "motivations", "goals"] } },
            },
            required: ["characters"],
          });
          const { object } = await generateStructured({
            model,
            schema: charSchema,
            system: withGlobalInstruction(
              `Bạn là nhà văn chuyên tạo nhân vật CHUYÊN SÂU. Nhiệm vụ: DỰA TRÊN ý tưởng của người dùng, PHÂN TÍCH TOÀN BỘ dữ liệu hiện có (thế giới, nhân vật hiện tại, mạch truyện, chương đã viết) rồi tạo NHÂN VẬT MỚI TOÀN DIỆN. Nhân vật mới phải:
1. PHÙ HỢP với thế giới quan (hệ thống sức mạnh, thế lực, bối cảnh)
2. LIÊN KẾT với nhân vật hiện có (quan hệ, xung đột, hợp tác)
3. ĐÓNG VAI TRÒ trong mạch truyện (thúc đẩy cốt truyện)
4. CÓ CHIỀU SÂU (tính cách phức tạp, động lực rõ ràng, mục tiêu cụ thể)
5. CHỈ tạo nhân vật MỚI chưa tồn tại.`,
              globalInstruction,
            ),
            prompt: `TOÀN BỘ DỮ LIỆU HIỆN CÓ (ĐỌC KỸ ĐỂ TẠO NHÂN VẬT PHÙ HỢP):\n${fullContext}\n\nÝ TƯỞNG BỔ SUNG:\n${supplementIdea}`,
            abortSignal: controller.signal,
          });
          if (object.characters?.length) {
            const now = new Date();
            await db.characters.bulkAdd(object.characters.map(c => ({
              id: crypto.randomUUID(), novelId, ...c, notes: "", createdAt: now, updatedAt: now,
            })));
          }
          break;
        }
        case "arcs": {
          const arcSchema = jsonSchema<{ arcs: { title: string; description: string; type: "main" | "subplot" | "character"; plotPoints: { title: string; description: string }[] }[] }>({
            type: "object",
            properties: {
              arcs: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, type: { type: "string", enum: ["main", "subplot", "character"] }, plotPoints: { type: "array", items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title", "description"] } } }, required: ["title", "description", "type", "plotPoints"] } },
            },
            required: ["arcs"],
          });
          const { object } = await generateStructured({
            model,
            schema: arcSchema,
            system: withGlobalInstruction(
              `Bạn là nhà văn chuyên xây dựng mạch truyện CHUYÊN SÂU. DỰA TRÊN ý tưởng, PHÂN TÍCH TOÀN BỘ dữ liệu rồi tạo MẠCH TRUYỆN MỚI. Truyện có ${targetChapterCount} chương, ${targetParts} phần. Mạch mới phải:
1. BỔ SUNG cho mạch hiện có (không trùng)
2. LIÊN KẾT nhân vật + thế giới quan
3. CÓ ĐIỂM MỐC phân bố qua ${targetParts} phần (ghi rõ thuộc Phần nào)
4. TẠO XUNG ĐỘT + cao trào
5. CHỈ tạo mạch MỚI.`,
              globalInstruction,
            ),
            prompt: `TOÀN BỘ DỮ LIỆU HIỆN CÓ:\n${fullContext}\n\nCẤU TRÚC: ${targetChapterCount} chương, ${targetParts} phần.\n${Array.from({ length: targetParts }, (_, i) => { const p = i + 1; const r = getPartRange(p); return `- Phần ${p} (Ch.${r.start}-${r.end})`; }).join("\n")}\n\nÝ TƯỞNG BỔ SUNG:\n${supplementIdea}`,
            abortSignal: controller.signal,
          });
          if (object.arcs?.length) {
            const now = new Date();
            await db.plotArcs.bulkAdd(object.arcs.map(a => ({
              id: crypto.randomUUID(), novelId, ...a,
              plotPoints: a.plotPoints.map(p => ({ ...p, id: crypto.randomUUID(), status: "planned" as const })),
              status: "active" as const, createdAt: now, updatedAt: now,
            })));
          }
          break;
        }
        case "plans": {
          const planSchema = jsonSchema<{ plans: { chapterOrder: number; title: string; directions: string[] }[] }>({
            type: "object",
            properties: {
              plans: { type: "array", items: { type: "object", properties: { chapterOrder: { type: "number" }, title: { type: "string" }, directions: { type: "array", items: { type: "string" } } }, required: ["chapterOrder", "title", "directions"] } },
            },
            required: ["plans"],
          });
          const { start: pStart, end: pEnd, count: pCount } = getPartRange(selectedPart);
          const { object } = await generateStructured({
            model,
            schema: planSchema,
            system: withGlobalInstruction(
              `Bạn là nhà văn chuyên lên kế hoạch chương CHUYÊN SÂU. Truyện có ${targetChapterCount} chương, ${targetParts} phần. Đang tạo cho Phần ${selectedPart} (Ch.${pStart}-${pEnd}). Kế hoạch phải:
1. NẰM TRONG phạm vi chương ${pStart}-${pEnd}
2. THEO SÁT mạch truyện và điểm mốc
3. PHÁT TRIỂN nhân vật
4. ${selectedPart > 1 ? "TIẾP NỐI từ phần trước" : "MỞ ĐẦU truyện"}
5. ${selectedPart < targetParts ? "CHUẨN BỊ cho phần sau" : "KẾT THÚC, giải quyết mọi xung đột"}
6. CHỈ tạo kế hoạch MỚI.`,
              globalInstruction,
            ),
            prompt: `TOÀN BỘ DỮ LIỆU HIỆN CÓ:\n${fullContext}\n\nCẤU TRÚC: ${targetChapterCount} chương, ${targetParts} phần. Đang tạo Phần ${selectedPart} (Ch.${pStart}-${pEnd}).\n\nÝ TƯỞNG BỔ SUNG:\n${supplementIdea}`,
            abortSignal: controller.signal,
          });
          if (object.plans?.length) {
            const now = new Date();
            await db.chapterPlans.bulkAdd(object.plans.map((p, i) => ({
              id: crypto.randomUUID(), novelId,
              chapterOrder: pStart + i,
              title: p.title, directions: p.directions,
              outline: "", scenes: [] as any[], status: "planned" as const,
              createdAt: now, updatedAt: now,
            })));
          }
          break;
        }
      }

      toast.success(`Đã bổ sung ${stepDef.label} thành công!`);
      setSupplementIdea("");
      setShowSupplement(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setIsSupplementing(false);
    }
  }, [novelId, currentStep, supplementIdea, novel, characters, plotArcs, chapterPlans, chapters, stepDef, buildFullContext, targetChapterCount, targetParts, selectedPart]);

  // ── Render step results ───────────────────────────────────

  const sectionCard = (
    icon: React.ComponentType<{ className?: string }>,
    color: string,
    label: string,
    value: string,
    onSave: (v: string) => void,
    multi = true,
  ) => {
    const Icon = icon;
    return (
      <div className="rounded-xl border p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className={cn("inline-flex size-7 items-center justify-center rounded-lg bg-muted", color)}>
            <Icon className="size-3.5" />
          </span>
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">{label}</p>
        </div>
        <EditableText
          value={value}
          onSave={onSave}
          placeholder={`Chưa có ${label.toLowerCase()}...`}
          multiline={multi}
          displayClassName="text-sm leading-relaxed"
        />
      </div>
    );
  };

  const itemList = (
    items: { name: string; description: string }[],
    icon: React.ComponentType<{ className?: string }>,
    color: string,
    label: string,
    onUpdate: (items: { name: string; description: string }[]) => void,
  ) => {
    const Icon = icon;
    return (
      <div className="rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className={cn("inline-flex size-7 items-center justify-center rounded-lg bg-muted", color)}>
            <Icon className="size-3.5" />
          </span>
          <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">{label}</p>
          {items.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60">({items.length})</span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="py-2 text-center text-xs italic text-muted-foreground/60">Chưa có {label.toLowerCase()} nào</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={`${item.name}-${i}`} className="group flex items-start gap-3 rounded-lg border border-border/50 bg-background/60 p-3 transition-colors hover:bg-background">
                <span className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold bg-muted", color)}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <EditableText
                    value={item.name}
                    onSave={(v) => { const next = [...items]; next[i] = { ...next[i], name: v }; onUpdate(next); }}
                    displayClassName="text-sm font-medium"
                  />
                  <EditableText
                    value={item.description}
                    onSave={(v) => { const next = [...items]; next[i] = { ...next[i], description: v }; onUpdate(next); }}
                    placeholder="Thêm mô tả..."
                    multiline
                    displayClassName="text-xs leading-relaxed text-muted-foreground"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderStepResult = () => {
    switch (currentStep) {
      case "world":
        return novel?.worldOverview ? (
          <div className="grid gap-3">
            <div className="col-span-1">
              {sectionCard(GlobeIcon, "text-blue-600 dark:text-blue-400", "Tổng quan thế giới", novel.worldOverview ?? "", (v) => updateNovel(novelId, { worldOverview: v }))}
            </div>
            {sectionCard(MapIcon, "text-emerald-600 dark:text-emerald-400", "Bối cảnh", novel.storySetting ?? "", (v) => updateNovel(novelId, { storySetting: v }))}
            {sectionCard(BookOpenIcon, "text-amber-600 dark:text-amber-400", "Thời kỳ", novel.timePeriod ?? "", (v) => updateNovel(novelId, { timePeriod: v }), false)}
            
            {sectionCard(BookOpenIcon, "text-indigo-600 dark:text-indigo-400", "Góc nhìn", novel.perspective ?? "", (v) => updateNovel(novelId, { perspective: v }))}
            {sectionCard(SparklesIcon, "text-teal-600 dark:text-teal-400", "Xưng hô", novel.pronouns ?? "", (v) => updateNovel(novelId, { pronouns: v }))}
            <div className="col-span-1">
              {sectionCard(PenIcon, "text-rose-600 dark:text-rose-400", "Phong cách hành văn", novel.writingStyle ?? "", (v) => updateNovel(novelId, { writingStyle: v }))}
            </div>

            <div className="col-span-1">
              {sectionCard(SparklesIcon, "text-red-600 dark:text-red-400", "Hệ thống sức mạnh", novel.powerSystem ?? "", (v) => updateNovel(novelId, { powerSystem: v }))}
            </div>
            <div className="col-span-1">
              {itemList(novel.factions ?? [], ShieldIcon, "text-violet-600 dark:text-violet-400", "Thế lực", (v) => updateNovel(novelId, { factions: v }))}
            </div>
            <div className="col-span-1">
              {itemList(novel.keyLocations ?? [], MapPinIcon, "text-cyan-600 dark:text-cyan-400", "Địa danh", (v) => updateNovel(novelId, { keyLocations: v }))}
            </div>
          </div>
        ) : null;

      case "characters":
        return characters && characters.length > 0 ? (
          <div className="space-y-2">
            {characters.map((c, i) => (
              <div key={c.id} className="group flex items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-accent/30">
                <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold bg-muted", "text-violet-600 dark:text-violet-400")}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <EditableText value={c.name} onSave={(v) => db.characters.update(c.id, { name: v, updatedAt: new Date() })} displayClassName="text-sm font-semibold" />
                    <Badge variant="secondary" className="text-[10px] font-normal shrink-0">{c.role}</Badge>
                  </div>
                  <EditableText value={c.description} multiline onSave={(v) => db.characters.update(c.id, { description: v, updatedAt: new Date() })} placeholder="Thêm mô tả..." displayClassName="text-xs leading-relaxed text-muted-foreground" />
                  <div className="grid gap-1 pt-1">
                    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-0.5">Tính cách</p>
                      <EditableText value={c.personality ?? ""} onSave={(v) => db.characters.update(c.id, { personality: v, updatedAt: new Date() })} placeholder="Chưa có..." displayClassName="text-xs" />
                    </div>
                    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-0.5">Động lực</p>
                      <EditableText value={c.motivations ?? ""} onSave={(v) => db.characters.update(c.id, { motivations: v, updatedAt: new Date() })} placeholder="Chưa có..." displayClassName="text-xs" />
                    </div>
                    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-0.5">Mục tiêu</p>
                      <EditableText value={c.goals ?? ""} onSave={(v) => db.characters.update(c.id, { goals: v, updatedAt: new Date() })} placeholder="Chưa có..." displayClassName="text-xs" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null;

      case "arcs":
        return plotArcs && plotArcs.length > 0 ? (
          <div className="space-y-4">
            {renderConfigPanel()}
            <div className="space-y-2">
              {plotArcs.map((a) => {
                const arcColor = a.type === "main" ? "text-red-600 dark:text-red-400" : a.type === "character" ? "text-violet-600 dark:text-violet-400" : "text-amber-600 dark:text-amber-400";
                return (
                  <div key={a.id} className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn("inline-flex size-7 items-center justify-center rounded-lg bg-muted", arcColor)}>
                        <MapIcon className="size-3.5" />
                      </span>
                      <EditableText value={a.title} onSave={(v) => db.plotArcs.update(a.id, { title: v, updatedAt: new Date() })} displayClassName="text-sm font-semibold" />
                      <Badge variant="secondary" className="text-[10px] font-semibold shrink-0 bg-violet-500/10 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">Lộ trình</Badge>
                    </div>
                    <EditableText value={a.description} multiline onSave={(v) => db.plotArcs.update(a.id, { description: v, updatedAt: new Date() })} placeholder="Thêm mô tả..." displayClassName="text-sm leading-relaxed text-muted-foreground" />
                    {a.plotPoints.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Điểm mốc</p>
                        {a.plotPoints.map((p, pi) => (
                          <div key={p.id} className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2">
                            <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-bold bg-muted", arcColor)}>
                              {pi + 1}
                            </span>
                            <EditableText value={p.title} onSave={(v) => { const pts = [...a.plotPoints]; pts[pi] = { ...pts[pi], title: v }; db.plotArcs.update(a.id, { plotPoints: pts, updatedAt: new Date() }); }} displayClassName="text-xs" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-start pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowSupplement(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-3 text-xs font-semibold bg-violet-500/5 border-violet-500/30 text-violet-600 hover:bg-violet-500/10 hover:text-violet-700 dark:bg-violet-500/10 dark:border-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/20 transition-all shadow-sm"
              >
                <PlusIcon className="size-3.5" />
                Tạo thêm hướng đi mới dựa trên ý tưởng mới và tham khảo mạch cũ
              </Button>
            </div>
          </div>
        ) : null;

      case "plans":
        return chapterPlans && chapterPlans.length > 0 ? (
          <div className="space-y-4">
            {renderConfigPanel()}
            <div className="space-y-2">
              {chapterPlans.map((p) => (
                <div key={p.id} className="group flex items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-accent/30">
                  <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold bg-muted text-emerald-600 dark:text-emerald-400">
                    {p.chapterOrder}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <EditableText value={p.title ?? ""} onSave={(v) => db.chapterPlans.update(p.id, { title: v, updatedAt: new Date() })} placeholder="Chưa đặt tên..." displayClassName="text-sm font-semibold" />
                    <EditableText
                      value={p.directions.join("\n")}
                      multiline
                      onSave={(v) => db.chapterPlans.update(p.id, { directions: v.split("\n").map((d) => d.trim()).filter(Boolean), updatedAt: new Date() })}
                      placeholder="Thêm hướng đi..."
                      displayClassName="text-xs leading-relaxed text-muted-foreground"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;
    }
  };

  // ── Reusable Config Panel ──────────────────────────────────
  const renderConfigPanel = () => {
    if (currentStep === "arcs") {
      return (
        <div className="w-full rounded-xl border bg-muted/20 p-4 space-y-4 shadow-sm mb-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              ⚙️ Cấu hình Phần & Chương (Volume Settings)
            </h4>
            {isOpenEnded && (
              <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200">
                Chưa kết chương (Open-ended)
              </Badge>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Tổng số chương mong muốn
              </label>
              <input
                type="number"
                min={5}
                max={500}
                value={targetChapterCount}
                onChange={(e) => setTargetChapterCount(Math.max(5, parseInt(e.target.value) || 50))}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:ring-1 focus:ring-primary focus-visible:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Số phần (Volume)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={targetParts}
                  onChange={(e) => setTargetParts(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                  className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm focus:ring-1 focus:ring-primary focus-visible:outline-none"
                />
                {isOpenEnded && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const nextParts = Math.min(10, targetParts + 1);
                      setTargetParts(nextParts);
                      setTargetChapterCount(nextParts * chaptersPerPart);
                      toast.success(`Đã thêm Phần ${nextParts}!`);
                    }}
                    className="px-2 text-xs h-auto shrink-0 border-blue-200 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                    title="Thêm phần mới"
                  >
                    + Thêm phần
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-md bg-background/60 border p-2.5 space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cấu trúc phân bổ:</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Array.from({ length: targetParts }, (_, i) => (
                <p key={i} className="text-[10px] text-muted-foreground/80 flex items-center gap-1">
                  <span className="size-1 bg-muted-foreground/40 rounded-full" />
                  {getPartLabel(i + 1)}
                </p>
              ))}
            </div>
          </div>

          {/* Toggle: Chưa kết chương */}
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-background/60 p-3">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                id="openEnded"
                checked={isOpenEnded}
                onChange={(e) => setIsOpenEnded(e.target.checked)}
                className="mt-0.5 rounded border-muted-foreground/30 size-4 text-primary focus:ring-primary"
              />
              <label htmlFor="openEnded" className="text-xs cursor-pointer select-none">
                <span className="font-semibold block text-foreground">Chưa kết chương (Open-ended)</span>
                <span className="text-muted-foreground text-[10px]">
                  Chỉ tạo mạch phần đầu trước, sau khi viết xong sẽ bổ sung thêm các phần tiếp theo.
                </span>
              </label>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/75 italic">
            {isOpenEnded
              ? `💡 AI sẽ tạo mạch truyện cho PHẦN ${selectedPart} (~${chaptersPerPart} chương), giữ cấu trúc mở để bạn thoải mái bổ sung sau.`
              : `💡 AI sẽ tạo mạch truyện hoàn chỉnh xuyên suốt từ Phần 1 (mở đầu) đến Phần ${targetParts} (kết thúc) qua ${targetChapterCount} chương.`}
          </p>

          {/* Cấu hình bổ sung riêng cho phần đang chọn (nếu là openEnded) */}
          {isOpenEnded && (
            <div className="space-y-3 rounded-lg border bg-background/40 p-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPartEnding"
                  checked={isPartEnding}
                  onChange={(e) => setIsPartEnding(e.target.checked)}
                  className="rounded border-muted-foreground/30 size-4 text-primary focus:ring-primary"
                />
                <label htmlFor="isPartEnding" className="text-xs cursor-pointer select-none font-semibold">
                  Phần này kết chương (Đây là phần kết thúc toàn bộ truyện)
                </label>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (currentStep === "plans") {
      return (
        <div className="w-full rounded-xl border bg-muted/20 p-4 space-y-4 shadow-sm mb-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              📝 Kế hoạch chương theo Phần (Volume Plans)
            </h4>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Chọn phần lên kế hoạch
              </label>
              <select
                value={selectedPart}
                onChange={(e) => setSelectedPart(parseInt(e.target.value))}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:ring-1 focus:ring-primary"
              >
                {Array.from({ length: targetParts }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {getPartLabel(i + 1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Số chương của phần này
              </label>
              <input
                type="number"
                value={getPartRange(selectedPart).count}
                disabled
                className="w-full rounded-md border bg-background/50 px-3 py-1.5 text-sm text-muted-foreground"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/80 italic">
            Tạo {getPartRange(selectedPart).count} chương cho {getPartLabel(selectedPart)}.
            {selectedPart > 1 && " AI sẽ đọc kế hoạch phần trước để duy trì tính liên kết chặt chẽ."}
            {selectedPart < targetParts && " AI sẽ sắp đặt các đầu mối gợi ý cho các phần sau."}
          </p>


        </div>
      );
    }
    return null;
  };

  // ── Empty state with inline config ────────────────────────
  const renderEmptyState = () => {
    const Icon = stepDef.icon;
    return (
      <div className="flex flex-col items-center max-w-lg mx-auto gap-4 w-full">
        <Empty className="border-0">
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{stepDef.label}</EmptyTitle>
            <EmptyDescription>{stepDef.description}</EmptyDescription>
          </EmptyHeader>
        </Empty>

        {renderConfigPanel()}

        <PipelineStepConfig
          novelId={novelId}
          role={SETUP_MODEL_ROLES[currentStep]}
          instructionKey={wizardInstructionKey}
          title={`Cấu hình: ${stepDef.label}`}
          description="Điều chỉnh mô hình, yêu cầu của bạn và system prompt (mở rộng) trước khi tạo."
          runLabel={
            isGenerating
              ? `Đang tạo ${stepDef.label.toLowerCase()}...`
              : `Tạo ${stepDef.label.toLowerCase()}`
          }
          onRun={handleGenerate}
          disabled={isGenerating}
          promptKeyOverride={SETUP_PROMPT_KEYS[currentStep]}
          defaultPromptOverride={getDefaultSetupPrompt(currentStep)}
        />

        {isGenerating && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              abortRef.current?.abort();
              setIsGenerating(false);
            }}
          >
            <XIcon className="h-3 w-3 mr-1" />
            Hủy
          </Button>
        )}

        {currentStep === "plans" && !isGenerating && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => void handleSkipPlans()}
          >
            Bỏ qua — tạo 5 chương trống
          </Button>
        )}
      </div>
    );
  };

  const showFooter = stepDone && !isGenerating && !wantsRegenerate;

  // ── Layout ────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Header: step pills + progress */}
      <div className="flex items-center justify-center border-b px-4 py-3">
        <div className="flex items-center gap-1">
          {STEPS.map((step, i) => {
            const done = isStepDone(step.key);
            const active = step.key === currentStep;
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center gap-1 sm:gap-2">
                {i > 0 && (
                  <div
                    className={`h-px w-2 sm:w-4 ${i <= currentStepIndex ? "bg-primary" : "bg-border"}`}
                  />
                )}
                <button
                  key={step.key}
                  onClick={() => {
                    setCurrentStep(step.key);
                    setWantsRegenerate(false);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : done
                        ? "bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/80",
                  )}
                >
                  {done ? (
                    <CheckCircle2Icon className="h-3 w-3" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{i + 1}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <ScrollArea
        className={
          showFooter ? `h-[calc(100dvh-208px)]` : `h-[calc(100dvh-148px)]`
        }
      >
        <div className="p-4 max-w-2xl mx-auto">
          {wantsRegenerate || isGenerating || !stepDone
            ? renderEmptyState()
            : renderStepResult()}
        </div>
      </ScrollArea>

      {/* Footer: actions when step is done */}
      {showFooter && (
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2 max-w-2xl mx-auto">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWantsRegenerate(true)}
                disabled={isGenerating || isSupplementing}
              >
                <RefreshCwIcon className="h-3.5 w-3.5 mr-1" />
                Tạo lại
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSupplement(!showSupplement)}
                disabled={isGenerating || isSupplementing}
                className={showSupplement ? "border-primary text-primary" : ""}
              >
                <PlusIcon className="h-3.5 w-3.5 mr-1" />
                Bổ sung bằng AI
              </Button>
            </div>

            <div className="flex-1" />

            <Button onClick={handleNext} disabled={isSupplementing}>
              {currentStepIndex < STEPS.length - 1 ? (
                <>
                  Tiếp theo
                  <ChevronRightIcon className="h-4 w-4 ml-1" />
                </>
              ) : (
                "Hoàn thành → Viết truyện"
              )}
            </Button>
          </div>

          {/* Supplement section */}
          {showSupplement && (
            <div className="max-w-2xl mx-auto mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <SparklesIcon className="h-3.5 w-3.5 text-primary" />
                Bổ sung {stepDef.label} bằng AI
              </p>
              <p className="text-[10px] text-muted-foreground">
                Nhập ý tưởng bổ sung. AI sẽ tạo nội dung mới phù hợp với dữ liệu hiện có (thế giới, nhân vật, mạch truyện...).
              </p>
              <Textarea
                value={supplementIdea}
                onChange={(e) => setSupplementIdea(e.target.value)}
                placeholder={`Ví dụ: Thêm một hệ thống ma thuật cổ đại, thêm nhân vật phản diện mới...`}
                className="h-20 text-sm resize-none bg-background"
                disabled={isSupplementing}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSupplement}
                  disabled={isSupplementing || !supplementIdea.trim()}
                  className="gap-1.5"
                >
                  {isSupplementing ? (
                    <><Loader2Icon className="h-3.5 w-3.5 animate-spin" /> Đang bổ sung...</>
                  ) : (
                    <><SparklesIcon className="h-3.5 w-3.5" /> Bổ sung bằng AI</>
                  )}
                </Button>
                {isSupplementing && (
                  <Button variant="ghost" size="sm" onClick={() => { supplementAbortRef.current?.abort(); setIsSupplementing(false); }}>
                    <XIcon className="h-3.5 w-3.5 mr-1" /> Hủy
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
