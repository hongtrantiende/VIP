import { tool } from "ai";
import { z } from "zod";

// ─── Aggregation Tools ──────────────────────────────────────

export const updateSynopsisTool = tool({
  description: "Cập nhật tóm tắt tiểu thuyết dựa trên nội dung chương mới",
  inputSchema: z.object({
    synopsis: z.string().describe("Tóm tắt đã cập nhật (3-6 câu)"),
  }),
});

export const updateGenresTagsTool = tool({
  description: "Cập nhật thể loại và/hoặc nhãn dựa trên nội dung mới",
  inputSchema: z.object({
    genres: z.array(z.string()).describe("Danh sách thể loại đã cập nhật đầy đủ"),
    tags: z.array(z.string()).describe("Danh sách nhãn đã cập nhật đầy đủ"),
  }),
});

export const updateWorldBuildingTool = tool({
  description: "Cập nhật các trường xây dựng thế giới. Chỉ bao gồm các trường đã thay đổi.",
  inputSchema: z.object({
    worldOverview: z.string().optional().describe("Tổng quan thế giới đã cập nhật"),
    powerSystem: z
      .string()
      .nullable()
      .optional()
      .describe("Mô tả hệ thống sức mạnh đã cập nhật, hoặc null nếu không áp dụng"),
    storySetting: z.string().optional().describe("Bối cảnh truyện đã cập nhật"),
    timePeriod: z
      .string()
      .nullable()
      .optional()
      .describe("Thời kỳ đã cập nhật"),
    worldRules: z
      .string()
      .nullable()
      .optional()
      .describe("Quy luật thế giới đã cập nhật"),
    technologyLevel: z
      .string()
      .nullable()
      .optional()
      .describe("Trình độ công nghệ đã cập nhật"),
    perspective: z
      .string()
      .nullable()
      .optional()
      .describe("Góc nhìn kể chuyện chính đã cập nhật"),
    pronouns: z
      .string()
      .nullable()
      .optional()
      .describe("Đại từ nhân xưng và quy tắc xưng hô đã cập nhật"),
    writingStyle: z
      .string()
      .nullable()
      .optional()
      .describe("Phong cách hành văn đã cập nhật"),
  }),
});

export const addFactionTool = tool({
  description: "Thêm phe phái hoặc tổ chức mới phát hiện trong các chương mới",
  inputSchema: z.object({
    name: z.string(),
    description: z.string(),
  }),
});

export const updateFactionTool = tool({
  description: "Cập nhật mô tả của phe phái đã có",
  inputSchema: z.object({
    name: z.string().describe("Tên chính xác của phe phái đã có"),
    description: z.string().describe("Mô tả đã cập nhật"),
  }),
});

export const addLocationTool = tool({
  description: "Thêm địa điểm quan trọng mới phát hiện trong các chương mới",
  inputSchema: z.object({
    name: z.string(),
    description: z.string(),
  }),
});

export const updateLocationTool = tool({
  description: "Cập nhật mô tả của địa điểm đã có",
  inputSchema: z.object({
    name: z.string().describe("Tên chính xác của địa điểm đã có"),
    description: z.string().describe("Mô tả đã cập nhật"),
  }),
});

export const aggregationTools = {
  update_synopsis: updateSynopsisTool,
  update_genres_tags: updateGenresTagsTool,
  update_world_building: updateWorldBuildingTool,
  add_faction: addFactionTool,
  update_faction: updateFactionTool,
  add_location: addLocationTool,
  update_location: updateLocationTool,
};

// ─── Character Tools ────────────────────────────────────────

const characterRelationshipSchema = z.object({
  characterName: z.string(),
  description: z.string().describe("Bản chất mối quan hệ"),
});

export const addCharacterTool = tool({
  description: "Thêm nhân vật mới phát hiện trong các chương mới",
  inputSchema: z.object({
    name: z.string(),
    role: z.string().describe("Nhân vật chính, người yêu, phản diện, hỗ trợ, phụ"),
    description: z.string().describe("Tổng quan nhân vật"),
    age: z.string().optional(),
    sex: z.string().optional(),
    appearance: z.string().optional(),
    personality: z.string().optional(),
    hobbies: z.string().optional(),
    relationshipWithMC: z.string().optional(),
    relationships: z.array(characterRelationshipSchema).optional(),
    characterArc: z.string().optional(),
    strengths: z.string().optional(),
    weaknesses: z.string().optional(),
    motivations: z.string().optional(),
    goals: z.string().optional(),
  }),
});

export const updateCharacterTool = tool({
  description:
    "Cập nhật các trường của nhân vật đã có. Chỉ bao gồm các trường đã thay đổi.",
  inputSchema: z.object({
    name: z.string().describe("Tên chính xác của nhân vật đã có"),
    role: z.string().optional(),
    description: z.string().optional(),
    age: z.string().optional(),
    sex: z.string().optional(),
    appearance: z.string().optional(),
    personality: z.string().optional(),
    hobbies: z.string().optional(),
    relationshipWithMC: z.string().optional(),
    characterArc: z.string().optional(),
    strengths: z.string().optional(),
    weaknesses: z.string().optional(),
    motivations: z.string().optional(),
    goals: z.string().optional(),
  }),
});

export const addRelationshipTool = tool({
  description: "Thêm mối quan hệ cho nhân vật đã có",
  inputSchema: z.object({
    characterName: z.string().describe("Tên nhân vật cần cập nhật"),
    relatedTo: z.string().describe("Tên nhân vật liên quan"),
    description: z.string().describe("Bản chất mối quan hệ"),
  }),
});

export const characterTools = {
  add_character: addCharacterTool,
  update_character: updateCharacterTool,
  add_relationship: addRelationshipTool,
};
