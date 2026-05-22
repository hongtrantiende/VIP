import { db, type Chapter } from "@/lib/db";

/**
 * Determine which chapters need (re-)analysis.
 *
 * A chapter needs analysis if:
 * - It has never been analyzed (no `analyzedAt`)
 * - Any of its scenes has been modified after `analyzedAt`
 */
export async function getChaptersNeedingAnalysis(novelId: string): Promise<{
  needsAnalysis: Chapter[];
  upToDate: Chapter[];
}> {
  const chapters = await db.chapters
    .where("novelId")
    .equals(novelId)
    .sortBy("order");

  const needsAnalysis: Chapter[] = [];
  const upToDate: Chapter[] = [];
  const allActiveScenes = await db.scenes
    .where("[novelId+isActive]")
    .equals([novelId, 1])
    .toArray();
  const latestEditByChapter = new Map<string, number>();
  for (const scene of allActiveScenes) {
    const ts = scene.updatedAt ? new Date(scene.updatedAt).getTime() : 0;
    const prev = latestEditByChapter.get(scene.chapterId) ?? 0;
    if (ts > prev) latestEditByChapter.set(scene.chapterId, ts);
  }

  for (const ch of chapters) {
    if (!ch.analyzedAt) {
      needsAnalysis.push(ch);
      continue;
    }
    const latestEdit = latestEditByChapter.get(ch.id) ?? 0;

    if (latestEdit > (ch.analyzedAt ? new Date(ch.analyzedAt).getTime() : 0)) {
      needsAnalysis.push(ch);
    } else {
      upToDate.push(ch);
    }
  }

  return { needsAnalysis, upToDate };
}
