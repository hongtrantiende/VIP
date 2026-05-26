import { jsonSchema } from "ai";
import type {
  ChapterAnalysisResult,
  BatchChapterAnalysisResult,
  IntermediateSummaryResult,
  NovelAggregationResult,
  CharacterProfilingResult,
} from "./types";

export const chapterAnalysisSchema = jsonSchema<ChapterAnalysisResult>({
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Tóm tắt ngắn gọn của chương (2-4 câu)",
    },
    keyScenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Tiêu đề ngắn của cảnh" },
          description: {
            type: "string",
            description: "Mô tả ngắn về cảnh",
          },
        },
        required: ["title", "description"],
        additionalProperties: false,
      },
      description: "Các cảnh hoặc sự kiện chính trong chương",
    },
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Tên nhân vật" },
          role: {
            type: "string",
            description:
              "Vai trò trong chương: nhân vật chính, phản diện, hỗ trợ, hoặc được đề cập",
          },
          noteInChapter: {
            type: "string",
            description: "Nhân vật đã làm gì hoặc xuất hiện như thế nào",
          },
        },
        required: ["name", "role", "noteInChapter"],
        additionalProperties: false,
      },
      description: "Các nhân vật xuất hiện hoặc được đề cập",
    },
  },
  required: ["summary", "keyScenes", "characters"],
  additionalProperties: false,
});

export const batchChapterAnalysisSchema =
  jsonSchema<BatchChapterAnalysisResult>({
    type: "object",
    properties: {
      chapters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "Tóm tắt ngắn gọn của chương (2-4 câu)",
            },
            keyScenes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "description"],
                additionalProperties: false,
              },
            },
            characters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  noteInChapter: { type: "string" },
                },
                required: ["name", "role", "noteInChapter"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "keyScenes", "characters"],
          additionalProperties: false,
        },
      },
    },
    required: ["chapters"],
    additionalProperties: false,
  });

export const intermediateSummarySchema =
  jsonSchema<IntermediateSummaryResult>({
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "Bản tóm tắt mạch lạc của nhóm chương, giữ lại cốt truyện, nhân vật và xây dựng thế giới quan",
      },
    },
    required: ["summary"],
    additionalProperties: false,
  });

export const novelAggregationSchema = jsonSchema<NovelAggregationResult>({
  type: "object",
  properties: {
    genres: {
      type: "array",
      items: { type: "string" },
      description: "Thể loại văn học (VD: Huyền huyễn, Ngôn tình, Khoa học viễn tưởng)",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "Nhãn mô tả (VD: slow-burn, isekai, tu tiên, xuyên không)",
    },
    synopsis: {
      type: "string",
      description:
        "Tóm tắt hấp dẫn về toàn bộ tiểu thuyết (3-6 câu)",
    },
    worldOverview: {
      type: "string",
      description: "Tổng quan về thế giới và bối cảnh",
    },
    powerSystem: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Mô tả hệ thống sức mạnh/phép thuật, hoặc null nếu không áp dụng",
    },
    storySetting: {
      type: "string",
      description: "Bối cảnh vật lý và xã hội của câu chuyện",
    },
    timePeriod: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Thời kỳ hoặc niên đại của câu chuyện, hoặc null nếu không rõ",
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
      description: "Các phe phái, tổ chức hoặc nhóm lớn",
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
        additionalProperties: false,
      },
      description: "Các địa điểm quan trọng trong truyện",
    },
    worldRules: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Các quy luật hoặc luật lệ chính của thế giới, hoặc null nếu không áp dụng",
    },
    technologyLevel: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Trình độ công nghệ của thế giới, hoặc null nếu không áp dụng",
    },
    perspective: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Góc nhìn kể chuyện chính (VD: Ngôi thứ ba toàn tri, ngôi thứ ba hạn tri, ngôi thứ nhất)",
    },
    pronouns: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Đại từ nhân xưng và quy tắc xưng hô trong dẫn chuyện (VD: hắn, y, nàng, tôi, ta)",
    },
    writingStyle: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Phong cách hành văn và văn phong đặc trưng của tác phẩm (VD: Hán Việt cổ trang, tiên hiệp trang nghiêm, hiện đại gần gũi)",
    },
  },
  required: [
    "genres",
    "tags",
    "synopsis",
    "worldOverview",
    "powerSystem",
    "storySetting",
    "timePeriod",
    "factions",
    "keyLocations",
    "worldRules",
    "technologyLevel",
    "perspective",
    "pronouns",
    "writingStyle",
  ],
  additionalProperties: false,
});

export const characterProfilingSchema = jsonSchema<CharacterProfilingResult>({
  type: "object",
  properties: {
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Họ tên đầy đủ" },
          age: {
            type: "string",
            description: "Tuổi hoặc khoảng tuổi, hoặc 'Không rõ' nếu không được nêu",
          },
          sex: {
            type: "string",
            description: "Nam, Nữ, hoặc Khác/Không rõ",
          },
          role: {
            type: "string",
            description:
              "Vai trò trong truyện: Nhân vật chính, người yêu, phản diện, hỗ trợ, phụ",
          },
          appearance: {
            type: "string",
            description: "Mô tả ngoại hình",
          },
          personality: {
            type: "string",
            description: "Đặc điểm tính cách và khí chất",
          },
          hobbies: {
            type: "string",
            description: "Sở thích, mối quan tâm và thói quen",
          },
          relationshipWithMC: {
            type: "string",
            description:
              "Mối quan hệ với nhân vật chính, hoặc 'N/A - đây là nhân vật chính' nếu là chính chủ",
          },
          relationships: {
            type: "array",
            items: {
              type: "object",
              properties: {
                characterName: { type: "string" },
                description: {
                  type: "string",
                  description: "Bản chất mối quan hệ",
                },
              },
              required: ["characterName", "description"],
              additionalProperties: false,
            },
            description: "Mối quan hệ với các nhân vật khác",
          },
          characterArc: {
            type: "string",
            description:
              "Sự phát triển và hành trình nhân vật xuyên suốt truyện",
          },
          strengths: { type: "string", description: "Điểm mạnh chính" },
          weaknesses: {
            type: "string",
            description: "Điểm yếu hoặc khuyết điểm chính",
          },
          motivations: {
            type: "string",
            description: "Động lực và mong muốn cốt lõi",
          },
          goals: {
            type: "string",
            description: "Mục tiêu và mục đích trong truyện",
          },
          description: {
            type: "string",
            description: "Tổng quan nhân vật (2-3 câu)",
          },
        },
        required: [
          "name",
          "age",
          "sex",
          "role",
          "appearance",
          "personality",
          "hobbies",
          "relationshipWithMC",
          "relationships",
          "characterArc",
          "strengths",
          "weaknesses",
          "motivations",
          "goals",
          "description",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["characters"],
  additionalProperties: false,
});
