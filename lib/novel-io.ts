import {
  db,
  type Novel,
  type Chapter,
  type Scene,
  type Character,
  type Note,
  type NameEntry,
  type ReplaceRule,
  type ExcludedName,
  type SceneVersionType,
} from "@/lib/db";
import JSZip from "jszip";

// ─── Export Format ──────────────────────────────────────────

export interface NovelExportData {
  version: 1 | 2;
  exportedAt: string;
  novel: Novel;
  chapters: Chapter[];
  scenes: Scene[];
  characters: Character[];
  notes: Note[];
  nameEntries?: NameEntry[];
  replaceRules?: ReplaceRule[];
  excludedNames?: ExcludedName[];
  /** @deprecated v1 only — analysis data is now on Novel */
  analyses?: unknown[];
}

// ─── Export ─────────────────────────────────────────────────

export async function exportNovel(
  novelId: string,
  options?: { includeVersions?: boolean; subTab?: "standard" | "ai" },
): Promise<NovelExportData> {
  const novel = await db.novels.get(novelId);
  if (!novel) throw new Error("Novel not found");

  const includeVersions = options?.includeVersions ?? false;
  const subTab = options?.subTab;

  const [allChapters, allScenes, characters, notes, nameEntries, replaceRules, excludedNames] =
    await Promise.all([
      db.chapters.where("novelId").equals(novelId).toArray(),
      includeVersions
        ? db.scenes.where("novelId").equals(novelId).toArray()
        : db.scenes
            .where("[novelId+isActive]")
            .equals([novelId, 1])
            .toArray(),
      db.characters.where("novelId").equals(novelId).toArray(),
      db.notes.where("novelId").equals(novelId).toArray(),
      db.nameEntries.where("scope").equals(novelId).toArray(),
      db.replaceRules.where("scope").equals(novelId).toArray(),
      db.excludedNames.where("scope").equals(novelId).toArray(),
    ]);

  const chapters = subTab === "ai"
    ? allChapters.filter(c => !!c.isAiWritten)
    : subTab === "standard"
      ? allChapters.filter(c => !c.isAiWritten)
      : allChapters;

  const chapterIds = new Set(chapters.map(c => c.id));
  const scenes = allScenes.filter(s => chapterIds.has(s.chapterId));

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    novel,
    chapters,
    scenes,
    characters,
    notes,
    ...(nameEntries.length > 0 ? { nameEntries } : {}),
    ...(replaceRules.length > 0 ? { replaceRules } : {}),
    ...(excludedNames.length > 0 ? { excludedNames } : {}),
  };
}

export function downloadNovelJson(data: NovelExportData) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.novel.title.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF ]/g, "_")}.novel.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function isSceneTranslated(s: Scene): boolean {
  if (s.version > 1) return true;
  if (s.activeSceneId) return true;
  if (s.versionType !== "manual") return true;
  if (s.content.includes("Bạn đang xem văn bản gốc chưa dịch")) return false;
  const hanziMatch = s.content.match(/[\u4E00-\u9FA5]/g);
  if (hanziMatch && hanziMatch.length > s.content.length * 0.1) return false;
  return true;
}

export async function downloadNovelChaptersZip(
  novelId: string,
  mode: "translated" | "original" = "translated",
  subTab?: "standard" | "ai",
) {
  const novel = await db.novels.get(novelId);
  if (!novel) throw new Error("Novel not found");

  const [allChapters, scenes] = await Promise.all([
    db.chapters.where("novelId").equals(novelId).sortBy("order"),
    mode === "translated"
      ? db.scenes.where("[novelId+isActive]").equals([novelId, 1]).toArray()
      : (async () => {
          const active = await db.scenes
            .where("[novelId+isActive]")
            .equals([novelId, 1])
            .toArray();
          return Promise.all(
            active.map(async (a) => {
              const original = await db.scenes
                .where("activeSceneId")
                .equals(a.id)
                .filter((v) => v.version === 1 && v.versionType === "manual")
                .first();
              return original || a;
            }),
          );
        })(),
  ]);

  const chapters = subTab === "ai"
    ? allChapters.filter(c => !!c.isAiWritten)
    : subTab === "standard"
      ? allChapters.filter(c => !c.isAiWritten)
      : allChapters;

  const zip = new JSZip();
  const folderName = `${novel.title.replace(/[/\\?%*:|"<>]/g, "_")}${mode === "original" ? "_GOC" : ""}`;
  const folder = zip.folder(folderName);

  if (!folder) throw new Error("Could not create folder in ZIP");

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const chapterScenes = scenes
      .filter((s) => s.chapterId === chapter.id)
      .sort((a, b) => a.order - b.order);

    if (mode === "translated" && subTab !== "ai") {
      const hasTranslatedContent = chapterScenes.some(isSceneTranslated);
      if (!hasTranslatedContent) continue;
    }

    const UNWANTED_TEXT =
      "Bạn đang xem văn bản gốc chưa dịch, có thể kéo xuống cuối trang để chọn bản dịch.";
    const content = chapterScenes
      .map((s) => s.content.replace(UNWANTED_TEXT, "").trim())
      .join("\n\n")
      .trim();
    const fileName = `${String(i + 1).padStart(4, "0")}_${chapter.title.replace(/[/\\?%*:|"<>]/g, "_")}.txt`;
    folder.file(fileName, content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${novel.title.replace(/[/\\?%*:|"<>]/g, "_")}_chapters${mode === "original" ? "_goc" : ""}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadNovelTxt(
  novelId: string,
  mode: "translated" | "original" = "translated",
  subTab?: "standard" | "ai",
) {
  const novel = await db.novels.get(novelId);
  if (!novel) throw new Error("Novel not found");

  const [allChapters, scenes] = await Promise.all([
    db.chapters.where("novelId").equals(novelId).sortBy("order"),
    mode === "translated"
      ? db.scenes.where("[novelId+isActive]").equals([novelId, 1]).toArray()
      : (async () => {
          const active = await db.scenes
            .where("[novelId+isActive]")
            .equals([novelId, 1])
            .toArray();
          return Promise.all(
            active.map(async (a) => {
              const original = await db.scenes
                .where("activeSceneId")
                .equals(a.id)
                .filter((v) => v.version === 1 && v.versionType === "manual")
                .first();
              return original || a;
            }),
          );
        })(),
  ]);

  const chapters = subTab === "ai"
    ? allChapters.filter(c => !!c.isAiWritten)
    : subTab === "standard"
      ? allChapters.filter(c => !c.isAiWritten)
      : allChapters;

  let content = `${novel.title}${mode === "original" ? " (Bản Gốc)" : ""}\n${novel.author ? `Tác giả: ${novel.author}\n` : ""}\n`;

  const UNWANTED_TEXT =
    "Bạn đang xem văn bản gốc chưa dịch, có thể kéo xuống cuối trang để chọn bản dịch.";

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const chapterScenes = scenes
      .filter((s) => s.chapterId === chapter.id)
      .sort((a, b) => a.order - b.order);

    if (mode === "translated" && subTab !== "ai") {
      const hasTranslatedContent = chapterScenes.some(isSceneTranslated);
      if (!hasTranslatedContent) continue;
    }

    const chapterContent = chapterScenes
      .map((s) => s.content.replace(UNWANTED_TEXT, "").trim())
      .join("\n\n")
      .trim();

    content += `\n\nChương ${i + 1}: ${chapter.title}\n\n${chapterContent}`;
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${novel.title.replace(/[/\\?%*:|"<>]/g, "_")}${mode === "original" ? "_goc" : ""}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Import ─────────────────────────────────────────────────

export async function importNovel(file: File, options?: { preserveId?: boolean }): Promise<string> {
  const text = await file.text();
  let data: NovelExportData;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Tệp JSON không hợp lệ.");
  }

  if (!data.version || !data.novel?.title) {
    throw new Error("Định dạng tệp không đúng.");
  }

  const preserveId = options?.preserveId ?? false;
  // Generate new IDs or use existing ones
  const novelId = preserveId ? data.novel.id : crypto.randomUUID();
  const now = new Date();

  // Map old IDs → new IDs
  const chapterIdMap = new Map<string, string>();
  const characterIdMap = new Map<string, string>();
  const sceneIdMap = new Map<string, string>();

  // Helper for DB operation
  const dbOp = preserveId ? "put" : "add";

  // Novel — merge v1 analysis data if present
  const novelData = { ...data.novel };
  if (data.version === 1 && Array.isArray(data.analyses) && data.analyses.length > 0) {
    const a = data.analyses[0] as Record<string, unknown>;
    if (a) {
      if (a.genres) novelData.genres = a.genres as string[];
      if (a.tags) novelData.tags = a.tags as string[];
      if (a.synopsis) novelData.synopsis = a.synopsis as string;
      if (a.worldOverview) novelData.worldOverview = a.worldOverview as string;
      if (a.powerSystem) novelData.powerSystem = a.powerSystem as string;
      if (a.storySetting) novelData.storySetting = a.storySetting as string;
      if (a.timePeriod) novelData.timePeriod = a.timePeriod as string;
      if (a.factions) novelData.factions = a.factions as Novel["factions"];
      if (a.keyLocations) novelData.keyLocations = a.keyLocations as Novel["keyLocations"];
      if (a.worldRules) novelData.worldRules = a.worldRules as string;
      if (a.technologyLevel) novelData.technologyLevel = a.technologyLevel as string;
      if (a.analysisStatus) novelData.analysisStatus = a.analysisStatus as Novel["analysisStatus"];
      if (a.chaptersAnalyzed) novelData.chaptersAnalyzed = a.chaptersAnalyzed as number;
      if (a.totalChapters) novelData.totalChapters = a.totalChapters as number;
      if (a.error) novelData.analysisError = a.error as string;
    }
  }

  await db.novels[dbOp]({
    ...novelData,
    id: novelId,
    createdAt: preserveId ? new Date(novelData.createdAt) : now,
    updatedAt: now,
  });

  // Chapters
  if (data.chapters?.length) {
    for (const ch of data.chapters) {
      const newId = preserveId ? ch.id : crypto.randomUUID();
      chapterIdMap.set(ch.id, newId);
      await db.chapters[dbOp]({
        originalTitle: ch.originalTitle || ch.title,
        ...ch,
        id: newId,
        novelId,
        createdAt: new Date(ch.createdAt),
        updatedAt: new Date(ch.updatedAt),
        analyzedAt: ch.analyzedAt ? new Date(ch.analyzedAt) : undefined,
      });
    }
  }

  // Scenes (active + inactive versions)
  if (data.scenes?.length) {
    for (const sc of data.scenes) {
      const newId = preserveId ? sc.id : crypto.randomUUID();
      sceneIdMap.set(sc.id, newId);
      await db.scenes[dbOp]({
        ...sc,
        id: newId,
        novelId,
        chapterId: chapterIdMap.get(sc.chapterId) ?? sc.chapterId,
        // Remap activeSceneId for inactive versions
        activeSceneId: sc.activeSceneId
          ? (sceneIdMap.get(sc.activeSceneId) ?? sc.activeSceneId)
          : undefined,
        // Ensure version fields have defaults for old exports without them
        version: sc.version ?? 0,
        versionType: (sc.versionType ?? "manual") as SceneVersionType,
        isActive: sc.isActive ?? 1,
        createdAt: new Date(sc.createdAt),
        updatedAt: new Date(sc.updatedAt),
      });
    }
  }

  // Second pass: fix activeSceneId for scenes imported before their parent
  if (data.scenes?.length) {
    for (const sc of data.scenes) {
      if (sc.activeSceneId && sceneIdMap.has(sc.activeSceneId)) {
        const newId = sceneIdMap.get(sc.id)!;
        const newActiveId = sceneIdMap.get(sc.activeSceneId)!;
        await db.scenes.update(newId, { activeSceneId: newActiveId });
      }
    }
  }

  // Characters
  if (data.characters?.length) {
    for (const char of data.characters) {
      const newId = preserveId ? char.id : crypto.randomUUID();
      characterIdMap.set(char.id, newId);
      await db.characters[dbOp]({
        ...char,
        id: newId,
        novelId,
        createdAt: new Date(char.createdAt),
        updatedAt: new Date(char.updatedAt),
      });
    }
  }

  // Remap characterIds in chapters
  if (characterIdMap.size > 0) {
    for (const ch of data.chapters ?? []) {
      if (ch.characterIds?.length) {
        const newChId = chapterIdMap.get(ch.id);
        if (newChId) {
          await db.chapters.update(newChId, {
            characterIds: ch.characterIds.map(
              (cid) => characterIdMap.get(cid) ?? cid
            ),
          });
        }
      }
    }
  }

  // Notes
  if (data.notes?.length) {
    for (const note of data.notes) {
      await db.notes[dbOp]({
        ...note,
        id: preserveId ? note.id : crypto.randomUUID(),
        novelId,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt),
      });
    }
  }

  // Name Entries (scope remaps from old novelId to new novelId)
  if (data.nameEntries?.length) {
    for (const entry of data.nameEntries) {
      const raw = entry as NameEntry & { category?: string; isRegex?: boolean; caseSensitive?: boolean; enabled?: boolean; order?: number };
      const entryId = preserveId ? entry.id : crypto.randomUUID();
      if (raw.category === "thay thế") {
        await db.replaceRules[dbOp]({
          id: entryId,
          scope: novelId,
          pattern: raw.chinese,
          replacement: raw.vietnamese,
          isRegex: raw.isRegex ?? false,
          caseSensitive: raw.caseSensitive ?? false,
          enabled: raw.enabled ?? true,
          order: raw.order ?? 0,
          createdAt: new Date(raw.createdAt),
          updatedAt: new Date(raw.updatedAt),
        });
      } else if (raw.category === "loại trừ") {
        await db.excludedNames[dbOp]({
          id: entryId,
          chinese: raw.chinese,
          scope: novelId,
          createdAt: new Date(raw.createdAt),
          updatedAt: new Date(raw.updatedAt),
        });
      } else {
        await db.nameEntries[dbOp]({
          ...entry,
          id: entryId,
          scope: novelId,
          createdAt: new Date(entry.createdAt),
          updatedAt: new Date(entry.updatedAt),
        });
      }
    }
  }

  // Replace Rules
  if (data.replaceRules?.length) {
    for (const rule of data.replaceRules) {
      await db.replaceRules[dbOp]({
        ...rule,
        id: preserveId ? rule.id : crypto.randomUUID(),
        scope: novelId,
        createdAt: new Date(rule.createdAt),
        updatedAt: new Date(rule.updatedAt),
      });
    }
  }

  // Excluded Names
  if (data.excludedNames?.length) {
    for (const entry of data.excludedNames) {
      await db.excludedNames[dbOp]({
        ...entry,
        id: preserveId ? entry.id : crypto.randomUUID(),
        scope: novelId,
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt),
      });
    }
  }

  return novelId;
}
