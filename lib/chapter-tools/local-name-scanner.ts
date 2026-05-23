import { db } from "@/lib/db";
import { getMergedNameDict } from "@/lib/hooks/use-name-entries";
import { getOriginalContent, createSceneVersion, ensureInitialVersion } from "@/lib/hooks/use-scene-versions";

export interface ScanIssue {
  id: string; // unique identifier
  chapterId: string;
  chapterTitle: string;
  sceneId: string;
  dictName: string;
  chineseName: string;
  matchedText: string;
  start: number;
  end: number;
  context: string;
}

/**
 * Normalizes Vietnamese string to ASCII lowercase characters for fuzzy matching
 */
export function toAsciiBase(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove tone marks
    .replace(/[đđ]/g, "d")
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a")
    .replace(/[èéẹẻẽêềếệểễ]/g, "e")
    .replace(/[ìíịỉĩ]/g, "i")
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o")
    .replace(/[ùúụủũưừứựửữ]/g, "u")
    .replace(/[ỳýỵỷỹ]/g, "y")
    .replace(/[^a-z0-9]/g, ""); // strip any other special characters
}

export interface Token {
  text: string;
  start: number;
  end: number;
  base: string;
}

/**
 * Tokenizes text into words containing letters and diacritics
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const regex = /[a-zA-ZÀ-ỹđĐ]+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const word = match[0];
    tokens.push({
      text: word,
      start: match.index,
      end: regex.lastIndex,
      base: toAsciiBase(word),
    });
  }
  return tokens;
}

/**
 * Extracts context (paragraph/line) around a matched word index
 */
function getParagraphContext(text: string, start: number, end: number): string {
  const prefix = text.slice(0, start);
  const lastNewline = Math.max(prefix.lastIndexOf("\n\n"), prefix.lastIndexOf("\n"));
  const pStart = lastNewline === -1 ? 0 : lastNewline + 1;

  const suffix = text.slice(end);
  const nextNewline = suffix.indexOf("\n\n") !== -1
    ? suffix.indexOf("\n\n")
    : suffix.indexOf("\n") !== -1
      ? suffix.indexOf("\n")
      : -1;
  const pEnd = nextNewline === -1 ? text.length : end + nextNewline;

  return text.slice(pStart, pEnd).trim();
}

/**
 * Scans a list of chapters for dictionary word variations
 */
export async function runLocalNameScan(
  novelId: string,
  chapterIds: string[],
  onProgress?: (chapterIndex: number, total: number) => void
): Promise<ScanIssue[]> {
  const nameDict = await getMergedNameDict(novelId);
  
  // Filter target dictionary names to entries with N >= 2 words to prevent false positives
  const targets = nameDict
    .map((entry) => {
      const name = entry.vietnamese.trim();
      const words = name.split(/\s+/).filter(Boolean);
      return {
        entry,
        name,
        words: words.map((w) => toAsciiBase(w)),
        length: words.length,
      };
    })
    .filter((t) => t.length >= 2);

  if (targets.length === 0) {
    return [];
  }

  const issues: ScanIssue[] = [];

  // Load all scenes for these chapters
  const allScenes = await db.scenes
    .where("[novelId+isActive]")
    .equals([novelId, 1])
    .toArray();

  const chapterIdSet = new Set(chapterIds);
  const scenesByChapter = new Map<string, typeof allScenes>();
  for (const s of allScenes) {
    if (!chapterIdSet.has(s.chapterId)) continue;
    const arr = scenesByChapter.get(s.chapterId) ?? [];
    arr.push(s);
    scenesByChapter.set(s.chapterId, arr);
  }

  for (let idx = 0; idx < chapterIds.length; idx++) {
    const chId = chapterIds[idx];
    const chapter = await db.chapters.get(chId);
    if (!chapter) continue;

    onProgress?.(idx, chapterIds.length);

    const chapterScenes = scenesByChapter.get(chId) ?? [];
    for (const scene of chapterScenes) {
      const text = scene.content;
      if (!text?.trim()) continue;

      const tokens = tokenize(text);
      if (tokens.length === 0) continue;

      // Keep track of character matches in this scene to avoid duplicates
      const matchedOffsets = new Set<string>();

      for (const target of targets) {
        for (let i = 0; i <= tokens.length - target.length; i++) {
          let match = true;
          for (let j = 0; j < target.length; j++) {
            if (tokens[i + j].base !== target.words[j]) {
              match = false;
              break;
            }
            if (j > 0 && tokens[i + j].start - tokens[i + j - 1].end > 3) {
              match = false;
              break;
            }
          }

          if (match) {
            const start = tokens[i].start;
            const end = tokens[i + target.length - 1].end;
            const offsetKey = `${start}-${end}`;

            if (matchedOffsets.has(offsetKey)) continue;

            const matchedText = text.slice(start, end);
            
            // Check if matchedText has exact spelling, ignore if exact match or if fully UPPERCASE
            if (matchedText !== target.name && matchedText !== matchedText.toUpperCase()) {
              matchedOffsets.add(offsetKey);
              
              const context = getParagraphContext(text, start, end);

              issues.push({
                id: crypto.randomUUID(),
                chapterId: chId,
                chapterTitle: chapter.title,
                sceneId: scene.id,
                dictName: target.name,
                chineseName: target.entry.chinese,
                matchedText,
                start,
                end,
                context,
              });
            }
          }
        }
      }
    }
  }

  onProgress?.(chapterIds.length, chapterIds.length);
  return issues;
}

/**
 * Apply the correction to a scene in the database and return the offset diff
 */
export async function applyFix(novelId: string, issue: ScanIssue): Promise<number> {
  const scene = await db.scenes.get(issue.sceneId);
  if (!scene) throw new Error("Scene not found");

  const originalContent = scene.content;
  const targetText = originalContent.slice(issue.start, issue.end);

  if (targetText !== issue.matchedText) {
    // If the text at the offset doesn't match matchedText, try to locate it near the offset
    // or fallback to replacing it in the entire text if unique, but index-based edit is preferred.
    throw new Error("Mẫu văn bản đã bị thay đổi bên ngoài.");
  }

  const before = originalContent.slice(0, issue.start);
  const after = originalContent.slice(issue.end);
  const updatedContent = before + issue.dictName + after;

  const origContent = await getOriginalContent(scene.id);
  await ensureInitialVersion(scene.id, novelId, origContent);
  await createSceneVersion(scene.id, novelId, "scan-fix", updatedContent);

  await db.scenes.update(scene.id, {
    content: updatedContent,
    wordCount: updatedContent.split(/\s+/).filter(Boolean).length,
    updatedAt: new Date(),
  });

  return issue.dictName.length - issue.matchedText.length;
}
