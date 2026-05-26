import { resolveStep } from "@/lib/ai/resolve-step";
import { db } from "@/lib/db";
import type { WritingAgentRole } from "@/lib/db";
import { withGlobalInstruction } from "@/lib/ai/system-prompt";
import { generateStructured } from "@/lib/ai/structured";
import { appendUserInstructionToPrompt } from "@/lib/writing/append-user-instruction";
import {
  DEFAULT_WORLD_BUILDING_SYSTEM,
  DEFAULT_CHARACTER_GENERATION_SYSTEM,
  DEFAULT_PLOT_ARC_SYSTEM,
  buildChapterPlanSystem,
} from "@/lib/writing/auto-generate-prompts";
import { jsonSchema } from "ai";
import type { LanguageModel } from "ai";

interface GenerateFrameworkOptions {
  novelId: string;
  genre?: string;
  setting?: string;
  idea: string;
  style?: string;
  systemPrompt?: string;
  userInstruction?: string;
  abortSignal?: AbortSignal;
  onPhase?: (phase: "world" | "characters" | "arcs" | "plans") => void;
}

interface WorldBuildingResult {
  worldOverview: string;
  powerSystem?: string;
  storySetting: string;
  timePeriod?: string;
  worldRules?: string;
  technologyLevel?: string;
  factions: Array<{ name: string; description: string }>;
  keyLocations: Array<{ name: string; description: string }>;
}

interface CharacterResult {
  characters: Array<{
    name: string;
    role: string;
    description: string;
    personality: string;
    motivations: string;
    goals: string;
  }>;
}

interface PlotArcResult {
  arcs: Array<{
    title: string;
    description: string;
    type: "main" | "subplot" | "character";
    plotPoints: Array<{
      title: string;
      description: string;
      chapterOrder?: number;
    }>;
  }>;
}

interface ChapterPlanResult {
  plans: Array<{
    chapterOrder: number;
    title: string;
    directions: string[];
  }>;
}

const worldSchema = jsonSchema<WorldBuildingResult>({
  type: "object",
  properties: {
    worldOverview: { type: "string" },
    powerSystem: { type: "string" },
    storySetting: { type: "string" },
    timePeriod: { type: "string" },
    worldRules: { type: "string" },
    technologyLevel: { type: "string" },
    factions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name", "description"],
      },
    },
    keyLocations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name", "description"],
      },
    },
  },
  required: ["worldOverview", "storySetting", "factions", "keyLocations"],
});

const characterSchema = jsonSchema<CharacterResult>({
  type: "object",
  properties: {
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          description: { type: "string" },
          personality: { type: "string" },
          motivations: { type: "string" },
          goals: { type: "string" },
        },
        required: [
          "name",
          "role",
          "description",
          "personality",
          "motivations",
          "goals",
        ],
      },
    },
  },
  required: ["characters"],
});

const plotArcSchema = jsonSchema<PlotArcResult>({
  type: "object",
  properties: {
    arcs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          type: { type: "string", enum: ["main", "subplot", "character"] },
          plotPoints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                chapterOrder: { type: "number" },
              },
              required: ["title", "description"],
            },
          },
        },
        required: ["title", "description", "type", "plotPoints"],
      },
    },
  },
  required: ["arcs"],
});

const chapterPlanSchema = jsonSchema<ChapterPlanResult>({
  type: "object",
  properties: {
    plans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chapterOrder: { type: "number" },
          title: { type: "string" },
          directions: { type: "array", items: { type: "string" } },
        },
        required: ["chapterOrder", "title", "directions"],
      },
    },
  },
  required: ["plans"],
});

async function getModelForRole(
  novelId: string,
  role: WritingAgentRole,
): Promise<LanguageModel> {
  const settings = await db.writingSettings.get(novelId);
  const stepModelKey = `${role}Model` as const;
  const stepConfig = settings?.[stepModelKey];
  if (stepConfig) {
    const model = await resolveStep(stepConfig);
    if (model) return model;
  }
  // Fallback to global default settings
  const globalSettings = await db.writingSettings.get("global-default");
  const globalConfig = globalSettings?.[stepModelKey];
  if (globalConfig) {
    const model = await resolveStep(globalConfig);
    if (model) return model;
  }
  const chatSettings = await db.chatSettings.get("default");
  if (chatSettings?.providerId && chatSettings?.modelId) {
    const model = await resolveStep({
      providerId: chatSettings.providerId,
      modelId: chatSettings.modelId,
    });
    if (model) return model;
  }
  throw new Error("Không tìm thấy mô hình AI. Vui lòng cấu hình trong Cài đặt.");
}

async function getGlobalInstruction(): Promise<string | undefined> {
  const chatSettings = await db.chatSettings.get("default");
  return chatSettings?.globalSystemInstruction;
}

/**
 * Generate world-building from an idea.
 */
export async function generateWorldBuilding(
  options: GenerateFrameworkOptions,
): Promise<WorldBuildingResult> {
  const model = await getModelForRole(options.novelId, "context");
  const globalInstruction = await getGlobalInstruction();

  const basePrompt = `Thể loại: ${options.genre ?? "Tự suy luận"}\nBối cảnh: ${options.setting ?? "Tự suy luận"}\nÝ tưởng: ${options.idea}\n${options.style ? `Phong cách: ${options.style}` : ""}`;

  const { object } = await generateStructured<WorldBuildingResult>({
    model,
    schema: worldSchema,
    system: withGlobalInstruction(
      options.systemPrompt ?? DEFAULT_WORLD_BUILDING_SYSTEM,
      globalInstruction,
    ),
    prompt: appendUserInstructionToPrompt(basePrompt, options.userInstruction),
    abortSignal: options.abortSignal,
  });
  return object;
}

/**
 * Generate characters from idea + world-building.
 */
export async function generateCharacters(
  options: GenerateFrameworkOptions,
  worldContext: string,
): Promise<CharacterResult> {
  const model = await getModelForRole(options.novelId, "direction");
  const globalInstruction = await getGlobalInstruction();

  const basePrompt = `Ý tưởng: ${options.idea}\n\nThế giới:\n${worldContext}`;

  const { object } = await generateStructured<CharacterResult>({
    model,
    schema: characterSchema,
    system: withGlobalInstruction(
      options.systemPrompt ?? DEFAULT_CHARACTER_GENERATION_SYSTEM,
      globalInstruction,
    ),
    prompt: appendUserInstructionToPrompt(basePrompt, options.userInstruction),
    abortSignal: options.abortSignal,
  });
  return object;
}

/**
 * Generate plot arcs from idea + world + characters.
 */
export async function generatePlotArcs(
  options: GenerateFrameworkOptions,
  context: string,
): Promise<PlotArcResult> {
  const model = await getModelForRole(options.novelId, "outline");
  const globalInstruction = await getGlobalInstruction();

  const basePrompt = `Ý tưởng: ${options.idea}\n\n${context}`;

  const { object } = await generateStructured<PlotArcResult>({
    model,
    schema: plotArcSchema,
    system: withGlobalInstruction(
      options.systemPrompt ?? DEFAULT_PLOT_ARC_SYSTEM,
      globalInstruction,
    ),
    prompt: appendUserInstructionToPrompt(basePrompt, options.userInstruction),
    abortSignal: options.abortSignal,
  });
  return object;
}

/**
 * Generate chapter plans from full context.
 */
export async function generateChapterPlans(
  options: GenerateFrameworkOptions,
  context: string,
  chapterCount: number = 8,
): Promise<ChapterPlanResult> {
  const model = await getModelForRole(options.novelId, "writer");
  const globalInstruction = await getGlobalInstruction();

  const basePrompt = `Ý tưởng: ${options.idea}\n\n${context}`;

  const { object } = await generateStructured<ChapterPlanResult>({
    model,
    schema: chapterPlanSchema,
    system: withGlobalInstruction(
      options.systemPrompt ?? buildChapterPlanSystem(chapterCount),
      globalInstruction,
    ),
    prompt: appendUserInstructionToPrompt(basePrompt, options.userInstruction),
    abortSignal: options.abortSignal,
  });
  return object;
}

/**
 * Save world-building result to Novel entity.
 */
export async function saveWorldBuilding(
  novelId: string,
  world: WorldBuildingResult,
) {
  await db.novels.update(novelId, {
    worldOverview: world.worldOverview,
    powerSystem: world.powerSystem,
    storySetting: world.storySetting,
    timePeriod: world.timePeriod,
    worldRules: world.worldRules,
    technologyLevel: world.technologyLevel,
    factions: world.factions,
    keyLocations: world.keyLocations,
    updatedAt: new Date(),
  });
}

/**
 * Save characters result to Character entities.
 */
export async function saveCharacters(
  novelId: string,
  result: CharacterResult,
) {
  await db.characters.where("novelId").equals(novelId).delete();
  const now = new Date();
  const entries = result.characters.map((char) => ({
    id: crypto.randomUUID(),
    novelId,
    name: char.name,
    role: char.role,
    description: char.description,
    personality: char.personality,
    motivations: char.motivations,
    goals: char.goals,
    notes: "",
    createdAt: now,
    updatedAt: now,
  }));
  await db.characters.bulkAdd(entries);
  return entries.map((e) => e.id);
}

/**
 * Save plot arcs result to PlotArc entities.
 */
export async function savePlotArcs(
  novelId: string,
  result: PlotArcResult,
  options?: { replaceAll?: boolean },
) {
  const replaceAll = options?.replaceAll ?? true;
  if (replaceAll) {
    await db.plotArcs.where("novelId").equals(novelId).delete();
  }
  const now = new Date();
  const entries = result.arcs.map((arc) => ({
    id: crypto.randomUUID(),
    novelId,
    title: arc.title,
    description: arc.description,
    type: arc.type,
    plotPoints: arc.plotPoints.map((p) => ({
      ...p,
      id: crypto.randomUUID(),
      status: "planned" as const,
    })),
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
  }));
  await db.plotArcs.bulkAdd(entries);
  return entries.map((e) => e.id);
}

/**
 * Save chapter plans result to ChapterPlan entities.
 */
export async function saveChapterPlans(
  novelId: string,
  result: ChapterPlanResult,
  options?: { replaceAll?: boolean },
) {
  const replaceAll = options?.replaceAll ?? true;
  if (replaceAll) {
    await db.chapterPlans.where("novelId").equals(novelId).delete();
  }
  const now = new Date();
  const entries = result.plans.map((plan) => ({
    id: crypto.randomUUID(),
    novelId,
    chapterOrder: plan.chapterOrder,
    title: plan.title,
    directions: plan.directions,
    outline: "",
    scenes: [] as import("@/lib/db").ChapterPlanScene[],
    status: "planned" as const,
    createdAt: now,
    updatedAt: now,
  }));
  await db.chapterPlans.bulkAdd(entries);
  return entries.map((e) => e.id);
}

export interface GenerateFromExistingOptions {
  abortSignal?: AbortSignal;
  onPhase?: (phase: "arcs" | "plans") => void;
  userInstruction?: string;
  /** "continue" = viết tiếp (giữ cũ, tạo thêm), "fresh" = viết lại từ đầu (xóa cũ, tạo mới từ chương 1) */
  mode?: "continue" | "fresh";
  planCount?: number;
}

/**
 * Generate plot arcs and chapter plans from existing novel data.
 * - mode="continue": tạo thêm arcs/plans tiếp nối (State B).
 * - mode="fresh": tạo lại toàn bộ arcs/plans từ chương 1.
 */
export async function generateFromExisting(
  novelId: string,
  options: GenerateFromExistingOptions = {},
) {
  const { abortSignal, onPhase, userInstruction, mode = "continue", planCount: customPlanCount } = options;
  const isFresh = mode === "fresh";

  const [novel, chapters, characters, existingPlans] = await Promise.all([
    db.novels.get(novelId),
    db.chapters.where("novelId").equals(novelId).sortBy("order"),
    db.characters.where("novelId").equals(novelId).toArray(),
    db.chapterPlans.where("novelId").equals(novelId).toArray(),
  ]);

  if (!novel) throw new Error("Novel not found");

  const context = [
    novel.synopsis ? `Tóm tắt: ${novel.synopsis}` : "",
    novel.worldOverview ? `Thế giới: ${novel.worldOverview}` : "",
    characters.length > 0
      ? `Nhân vật: ${characters.map((c) => `${c.name} (${c.role})`).join(", ")}`
      : "",
    // Khi viết lại từ đầu, vẫn tham khảo chương cũ để AI hiểu mạch truyện
    chapters.length > 0
      ? `Chương đã có (tham khảo):\n${chapters.map((ch) => `${ch.order}. ${ch.title}${ch.summary ? `: ${ch.summary}` : ""}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const idea = novel.synopsis || novel.description || novel.title;
  // Viết lại → bắt đầu từ chương 1, viết tiếp → bắt đầu từ chương tiếp theo (check maxPlanOrder để tránh trùng lặp)
  const maxPlanOrder = existingPlans.reduce((max, p) => Math.max(max, p.chapterOrder), 0);
  const startChapter = isFresh ? 1 : (maxPlanOrder > 0 ? maxPlanOrder + 1 : chapters.length + 1);
  // Viết lại/Viết tiếp → tạo nhiều chương hơn để cover
  const planCount = customPlanCount ?? (isFresh ? Math.max(chapters.length, 10) : 5);

  onPhase?.("arcs");
  const arcsResult = await generatePlotArcs(
    { novelId, idea, abortSignal, userInstruction },
    context,
  );
  await savePlotArcs(novelId, arcsResult, { replaceAll: isFresh });

  onPhase?.("plans");
  const arcContext =
    context +
    `\n\nMạch truyện:\n${arcsResult.arcs.map((a) => `- ${a.title} (${a.type}): ${a.description}`).join("\n")}` +
    (isFresh ? `\n\nYÊU CẦU: Tạo kế hoạch chương từ CHƯƠNG 1, bao phủ toàn bộ cốt truyện từ đầu đến cuối. Tổng cộng khoảng ${planCount} chương.` : "");
  const plansResult = await generateChapterPlans(
    { novelId, idea, abortSignal, userInstruction },
    arcContext,
    planCount,
  );
  plansResult.plans = plansResult.plans.map((p, i) => ({
    ...p,
    chapterOrder: startChapter + i,
  }));
  await saveChapterPlans(novelId, plansResult, { replaceAll: isFresh });

  return { arcs: arcsResult, plans: plansResult };
}

/**
 * Generate the entire novel configuration (World, Characters, Arcs, Plans) from scratch.
 * Done in a single comprehensive pipeline.
 */
export async function generateAllFromScratch(
  novelId: string,
  options: {
    idea: string;
    targetChapterCount: number;
    abortSignal?: AbortSignal;
    onPhase?: (phase: "world" | "characters" | "arcs" | "plans") => void;
  },
) {
  const { idea, targetChapterCount, abortSignal, onPhase } = options;
  const chaptersPerPart = Math.ceil(targetChapterCount / 3);

  // Clear existing setup data
  await Promise.all([
    db.characters.where("novelId").equals(novelId).delete(),
    db.plotArcs.where("novelId").equals(novelId).delete(),
    db.chapterPlans.where("novelId").equals(novelId).delete(),
    db.writingSessions.where("novelId").equals(novelId).delete(),
  ]);

  // Update writingSettings with targetChapterCount and targetParts, ensuring it exists
  const existingSettings = await db.writingSettings.get(novelId);
  if (!existingSettings) {
    const now = new Date();
    await db.writingSettings.put({
      id: novelId,
      chapterLength: 3000,
      targetChapterCount,
      targetParts: 3,
      isOpenEnded: false,
      isPartEnding: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db.writingSettings.update(novelId, {
      targetChapterCount,
      targetParts: 3, // Default to 3 parts for standard structure
      isOpenEnded: false,
      isPartEnding: true,
    } as any);
  }

  const genOptions = {
    novelId,
    idea,
    abortSignal,
  };

  // Phase 1: World-Building
  onPhase?.("world");
  const worldResult = await generateWorldBuilding(genOptions);
  await saveWorldBuilding(novelId, worldResult);

  // Build world context for subsequent steps
  const worldContext = [
    worldResult.worldOverview ? `Thế giới: ${worldResult.worldOverview}` : "",
    worldResult.storySetting ? `Bối cảnh: ${worldResult.storySetting}` : "",
    worldResult.powerSystem ? `Hệ thống sức mạnh: ${worldResult.powerSystem}` : "",
    worldResult.factions?.length
      ? `Thế lực:\n${worldResult.factions.map((f) => `${f.name}: ${f.description}`).join("\n")}`
      : "",
    worldResult.keyLocations?.length
      ? `Địa danh:\n${worldResult.keyLocations.map((l) => `${l.name}: ${l.description}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Phase 2: Characters
  onPhase?.("characters");
  const charResult = await generateCharacters(genOptions, worldContext);
  await saveCharacters(novelId, charResult);

  const charContext = charResult.characters?.length
    ? `Nhân vật:\n${charResult.characters.map((c) => `${c.name} (${c.role}): ${c.description}`).join("\n")}`
    : "";

  // Phase 3: Plot Arcs (Hướng đi nhân vật chính - Sequential MC Trajectory Stages)
  onPhase?.("arcs");
  const arcContext = [
    worldContext,
    charContext,
    `\n\nYÊU CẦU: Thiết lập HƯỚNG ĐI / LỘ TRÌNH PHÁT TRIỂN của nhân vật chính cho toàn bộ truyện gồm ${targetChapterCount} chương.
Hãy chia lộ trình này thành các Mạch hành trình tuần tự tiếp nối nhau (Ví dụ: Mạch 1 từ Chương 1 đến Chương 25, Mạch 2 từ Chương 26 đến Chương 60, v.v.).
Trong mỗi mạch hành trình:
- Xác định khoảng chương bắt đầu và kết thúc cụ thể.
- Mô tả rõ sự trưởng thành của nhân vật chính qua thời gian (phát triển tâm lý, sức mạnh từ yếu đuối phế vật lên mạnh mẽ, khôn ngoan).
- Tạo các điểm mốc cốt truyện (plot points) tương ứng với mạch đó.
Các mạch phải kế thừa và tiếp nối nhau một cách logic, tạo nên hành trình nhân vật hoàn chỉnh qua ${targetChapterCount} chương.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const arcsResult = await generatePlotArcs(genOptions, arcContext);
  await savePlotArcs(novelId, arcsResult);

  const arcContextList = arcsResult.arcs
    .map((a) => `- ${a.title} (${a.type}): ${a.description}`)
    .join("\n");

  // Phase 4: Chapter Plans (Generate only the first 5 chapters initially)
  onPhase?.("plans");
  const planPartsInfo = Array.from({ length: 3 }, (_, i) => {
    const p = i + 1;
    const start = (p - 1) * chaptersPerPart + 1;
    const end = Math.min(p * chaptersPerPart, targetChapterCount);
    return `- Phần ${p} (Ch.${start}-${end})`;
  }).join("\n");

  const planContext = [
    worldContext,
    charContext,
    `\n\nMạch truyện:\n${arcContextList}`,
    `\n\nCẤU TRÚC TRUYỆN (${targetChapterCount} chương, 3 phần):\n${planPartsInfo}\n\nYÊU CẦU: Chỉ tạo kế hoạch CHI TIẾT cho 5 chương ĐẦU TIÊN (Chương 1 đến Chương 5) của bộ truyện, bao phủ những diễn biến khởi đầu của mạch truyện.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const plansResult = await generateChapterPlans(
    genOptions,
    planContext,
    5, // Only 5 chapters initially
  );
  // Ensure correct chapterOrder
  plansResult.plans = plansResult.plans.map((p, i) => ({
    ...p,
    chapterOrder: i + 1,
  }));
  await saveChapterPlans(novelId, plansResult);
}
