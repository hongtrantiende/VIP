import { db, type Character } from "@/lib/db";
import { tool } from "ai";
import { z } from "zod";

const MAX_CONTENT_LENGTH = 8000;

async function resolveChapter(novelId: string, chapterRef: string) {
  const byId = await db.chapters.get(chapterRef);
  if (byId && byId.novelId === novelId) return byId;

  const num = Number(chapterRef);
  if (Number.isInteger(num) && num >= 0) {
    const chapters = await db.chapters
      .where("novelId")
      .equals(novelId)
      .sortBy("order");
    const idx = num === 0 ? 0 : num - 1;
    return chapters[idx] ?? null;
  }

  return null;
}

function mapCharacter(c: Character) {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    description: c.description,
    notes: c.notes,
    age: c.age,
    sex: c.sex,
    appearance: c.appearance,
    personality: c.personality,
    hobbies: c.hobbies,
    relationshipWithMC: c.relationshipWithMC,
    relationships: c.relationships,
    characterArc: c.characterArc,
    strengths: c.strengths,
    weaknesses: c.weaknesses,
    motivations: c.motivations,
    goals: c.goals,
  };
}

function mapCharacterBasic(c: Character) {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    relationshipWithMC: c.relationshipWithMC,
  };
}

/**
 * Read/search-only tools for novel retrieval (no DB mutations).
 * Same behavior as the read tools in createChatTools.
 */
export function createNovelReadTools(novelId: string) {
  return {
    getNovelOverview: tool({
      description:
        "Lấy thông tin tổng quan tiểu thuyết: metadata, thể loại, nhãn, xây dựng thế giới, hệ thống sức mạnh, bối cảnh, phe phái, địa danh.",
      inputSchema: z.object({}),
      execute: async () => {
        const novel = await db.novels.get(novelId);
        if (!novel) return { error: "Không tìm thấy tiểu thuyết" };
        return {
          title: novel.title,
          description: novel.description,
          author: novel.author,
          synopsis: novel.synopsis,
          genres: novel.genres,
          tags: novel.tags,
          worldOverview: novel.worldOverview,
          powerSystem: novel.powerSystem,
          storySetting: novel.storySetting,
          timePeriod: novel.timePeriod,
          factions: novel.factions,
          keyLocations: novel.keyLocations,
          worldRules: novel.worldRules,
          technologyLevel: novel.technologyLevel,
        };
      },
    }),

    getWorldBuilding: tool({
      description:
        "Tra cứu chi tiết xây dựng thế giới: phe phái (tên + mô tả), địa danh (tên + mô tả), hệ thống sức mạnh, bối cảnh, quy luật thế giới, trình độ công nghệ, thời kỳ. Có thể lọc theo loại cụ thể.",
      inputSchema: z.object({
        category: z
          .enum([
            "all",
            "factions",
            "locations",
            "powerSystem",
            "storySetting",
            "worldRules",
            "technologyLevel",
            "timePeriod",
          ])
          .optional()
          .describe(
            "Loại thông tin cần lấy (mặc định: all). factions = phe phái, locations = địa danh, powerSystem = hệ thống sức mạnh, storySetting = bối cảnh, worldRules = quy luật, technologyLevel = công nghệ, timePeriod = thời kỳ",
          ),
        search: z
          .string()
          .optional()
          .describe(
            "Từ khóa tìm kiếm trong phe phái/địa danh (lọc theo tên hoặc mô tả)",
          ),
      }),
      execute: async ({ category = "all", search }) => {
        const novel = await db.novels.get(novelId);
        if (!novel) return { error: "Không tìm thấy tiểu thuyết" };

        const filterItems = (
          items: { name: string; description: string }[] | undefined,
        ) => {
          if (!items) return [];
          if (!search) return items;
          const q = search.normalize("NFC").toLowerCase();
          return items.filter(
            (item) =>
              item.name.normalize("NFC").toLowerCase().includes(q) ||
              item.description.normalize("NFC").toLowerCase().includes(q),
          );
        };

        if (category === "all") {
          return {
            worldOverview: novel.worldOverview,
            powerSystem: novel.powerSystem,
            storySetting: novel.storySetting,
            timePeriod: novel.timePeriod,
            worldRules: novel.worldRules,
            technologyLevel: novel.technologyLevel,
            factions: filterItems(novel.factions),
            keyLocations: filterItems(novel.keyLocations),
          };
        }

        switch (category) {
          case "factions":
            return { factions: filterItems(novel.factions) };
          case "locations":
            return { keyLocations: filterItems(novel.keyLocations) };
          case "powerSystem":
            return { powerSystem: novel.powerSystem };
          case "storySetting":
            return { storySetting: novel.storySetting };
          case "worldRules":
            return { worldRules: novel.worldRules };
          case "technologyLevel":
            return { technologyLevel: novel.technologyLevel };
          case "timePeriod":
            return { timePeriod: novel.timePeriod };
        }
      },
    }),

    getChapterDetails: tool({
      description:
        'Lấy chi tiết chương: tiêu đề, tóm tắt, danh sách scene (tiêu đề và số từ). Có thể truyền số thứ tự chương (vd: "1", "2") hoặc UUID. Bỏ qua để lấy danh sách tất cả chương.',
      inputSchema: z.object({
        chapter: z
          .string()
          .optional()
          .describe(
            'Số thứ tự chương (vd: "1") hoặc UUID (bỏ qua để lấy tất cả)',
          ),
      }),
      execute: async ({ chapter: chapterRef }) => {
        if (chapterRef) {
          const chapter = await resolveChapter(novelId, chapterRef);
          if (!chapter) return { error: "Không tìm thấy chương" };

          const scenes = await db.scenes
            .where("[chapterId+isActive]")
            .equals([chapter.id, 1])
            .sortBy("order");

          return {
            chapterNumber: chapter.order,
            title: chapter.title,
            summary: chapter.summary,
            scenes: scenes.map((s) => ({
              title: s.title,
              wordCount: s.wordCount,
            })),
          };
        }

        const chapters = await db.chapters
          .where("novelId")
          .equals(novelId)
          .sortBy("order");

        return {
          chapters: chapters.map((c) => ({
            chapterNumber: c.order,
            title: c.title,
            summary: c.summary,
          })),
        };
      },
    }),

    getChapterContent: tool({
      description:
        'Lấy nội dung văn bản đầy đủ của các scene trong một chương. Có thể truyền số thứ tự chương (vd: "1") hoặc UUID.',
      inputSchema: z.object({
        chapter: z.string().describe('Số thứ tự chương (vd: "1") hoặc UUID'),
      }),
      execute: async ({ chapter: chapterRef }) => {
        const chapter = await resolveChapter(novelId, chapterRef);
        if (!chapter) return { error: "Không tìm thấy chương" };

        const scenes = await db.scenes
          .where("[chapterId+isActive]")
          .equals([chapter.id, 1])
          .sortBy("order");

        let totalLength = 0;
        const result: { title: string; content: string }[] = [];

        for (const scene of scenes) {
          const remaining = MAX_CONTENT_LENGTH - totalLength;
          if (remaining <= 0) {
            result.push({
              title: scene.title,
              content: "[Đã bỏ qua do vượt giới hạn ký tự]",
            });
            continue;
          }
          const content =
            scene.content.length > remaining
              ? scene.content.slice(0, remaining) + "\n...[đã cắt bớt]"
              : scene.content;
          totalLength += content.length;
          result.push({ title: scene.title, content });
        }

        return {
          chapterTitle: chapter.title,
          scenes: result,
        };
      },
    }),

    getCharacters: tool({
      description:
        "Lấy thông tin nhân vật. Nếu truyền characterId thì trả về đầy đủ trường của nhân vật đó và các chapter có mặt. Nếu không truyền thì trả về danh sách cơ bản (id, tên, vai trò, relationshipWithMC) của tất cả nhân vật.",
      inputSchema: z.object({
        characterId: z
          .string()
          .optional()
          .describe("ID nhân vật cụ thể (bỏ qua để lấy tất cả)"),
      }),
      execute: async ({ characterId }) => {
        if (characterId) {
          const char = await db.characters.get(characterId);
          if (!char || char.novelId !== novelId)
            return { error: "Không tìm thấy nhân vật" };
          const chapters = await db.chapters
            .where("novelId")
            .equals(novelId)
            .sortBy("order");
          const appearsInChapters = chapters
            .filter((chapter) => (chapter.characterIds ?? []).includes(char.id))
            .map((chapter) => ({
              id: chapter.id,
              order: chapter.order,
              title: chapter.title,
              summary: chapter.summary,
            }));

          return {
            ...mapCharacter(char),
            chapters: appearsInChapters,
          };
        }

        const characters = await db.characters
          .where("novelId")
          .equals(novelId)
          .toArray();

        return { characters: characters.map(mapCharacterBasic) };
      },
    }),

    getNovelNotes: tool({
      description:
        "Lấy ghi chú của người dùng về tiểu thuyết (tài liệu tham khảo, ý tưởng, ghi chú cá nhân).",
      inputSchema: z.object({}),
      execute: async () => {
        const notes = await db.notes.where("novelId").equals(novelId).toArray();

        return {
          notes: notes.map((n) => ({
            id: n.id,
            title: n.title,
            category: n.category,
            content: n.content,
          })),
        };
      },
    }),

    searchNovelContent: tool({
      description:
        "Tìm kiếm toàn văn (fuzzy) trong nội dung tiểu thuyết: scene, chương, nhân vật, ghi chú, thông tin novel. Hỗ trợ lọc theo một hoặc nhiều type và tìm gần đúng (typo, dấu).",
      inputSchema: z.object({
        query: z.string().describe("Từ khóa hoặc cụm từ cần tìm"),
        limit: z
          .number()
          .optional()
          .describe("Số lượng kết quả tối đa, mặc định 5"),
        types: z
          .array(z.enum(["novel", "chapter", "character", "note", "scene"]))
          .optional()
          .describe(
            'Lọc theo một hoặc nhiều loại kết quả. Ví dụ: ["chapter"] hoặc ["character", "note"]',
          ),
      }),
      execute: async ({ query, limit = 5, types }) => {
        const { globalSearch } = await import("@/lib/search/global-search");
        const defaultSearchTypes = [
          "novel",
          "chapter",
          "character",
          "note",
          "scene",
        ] as const;
        let searchTypes: (typeof defaultSearchTypes)[number][];
        if (!types) {
          searchTypes = [...defaultSearchTypes];
        } else if (Array.isArray(types)) {
          searchTypes = types;
        } else {
          searchTypes = [types];
        }
        const hits = await globalSearch(query, {
          novelId,
          limit,
          types: searchTypes,
        });

        return {
          query,
          totalResults: hits.length,
          results: hits.map((h) => ({
            type: h.type,
            location: h.subtitle,
            title: h.title,
            score: h.score,
          })),
        };
      },
    }),
  };
}
