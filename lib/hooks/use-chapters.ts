"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState, useEffect } from "react";
import { db, type Chapter } from "@/lib/db";

function getTimestamp(val: any): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return val;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

export function useChapters(novelId: string | undefined, isAiWritten?: boolean) {
  const chapters = useLiveQuery(
    async () => {
      if (!novelId) return [];
      const list = await db.chapters.where("novelId").equals(novelId).sortBy("order");
      if (isAiWritten !== undefined) {
        return list.filter((ch) => !!ch.isAiWritten === isAiWritten);
      }
      return list;
    },
    [novelId, isAiWritten]
  );
  return chapters;
}

export function useChapter(id: string | undefined) {
  const chapter = useLiveQuery(
    () => (id ? db.chapters.get(id) : undefined),
    [id]
  );
  return chapter;
}

export async function createChapter(
  data: Omit<Chapter, "id" | "createdAt" | "updatedAt">
) {
  const now = new Date();
  const id = crypto.randomUUID();
  await db.chapters.add({
    originalTitle: data.originalTitle || data.title,
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateChapter(
  id: string,
  data: Partial<Omit<Chapter, "id" | "createdAt">>
) {
  await db.chapters.update(id, { ...data, updatedAt: new Date() });
}

export async function deleteChapter(id: string) {
  await db.transaction("rw", [db.chapters, db.scenes], async () => {
    // Deletes both active scenes and their inactive versions (share chapterId)
    await db.scenes.where("chapterId").equals(id).delete();
    await db.chapters.delete(id);
  });
}

export type ChapterAnalysisStatus = "analyzed" | "stale" | "unanalyzed";

export function useChapterAnalysisStatus(novelId: string | undefined) {
  return useLiveQuery(
    async () => {
      if (!novelId) return [];
      const chapters = await db.chapters
        .where("novelId")
        .equals(novelId)
        .sortBy("order");

      const latestEditByChapter = new Map<string, number>();
      await db.scenes
        .where("[novelId+isActive]")
        .equals([novelId, 1])
        .each((s) => {
          const t = getTimestamp(s.updatedAt);
          const current = latestEditByChapter.get(s.chapterId) || 0;
          if (t > current) {
            latestEditByChapter.set(s.chapterId, t);
          }
        });

      return chapters.map((ch) => {
        if (!ch.analyzedAt) return { chapterId: ch.id, status: "unanalyzed" as const };
        const latestEdit = latestEditByChapter.get(ch.id) || 0;
        return {
          chapterId: ch.id,
          status: latestEdit > getTimestamp(ch.analyzedAt) ? "stale" as const : "analyzed" as const,
        };
      });
    },
    [novelId],
  );
}

export function useNovelDetailStats(novelId: string | undefined) {
  // Trì hoãn việc chạy query nặng lúc mới mount để không chặn (block) thread khi chuyển trang.
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    // Đợi 150ms sau khi chuyển trang xong mới bắt đầu load
    const timer = setTimeout(() => setShouldLoad(true), 150);
    return () => clearTimeout(timer);
  }, []);

  return useLiveQuery(
    async () => {
      const chapterWordCounts = new Map<string, number>();
      const chapterOriginalWordCounts = new Map<string, number>();
      const latestEditByChapter = new Map<string, number>();
      const translatedChapterIds = new Set<string>();
      if (!novelId || !shouldLoad) {
        return {
          chapterWordCounts,
          chapterOriginalWordCounts,
          analysisStatuses: [],
          translatedChapterIds,
        };
      }

      const chapters = await db.chapters
        .where("novelId")
        .equals(novelId)
        .sortBy("order");

      // Fetch ALL active scenes at once to avoid O(N^2) .offset() performance penalty.
      // In IndexedDb, reading 3000-5000 small records is extremely fast (~50ms), 
      // whereas looping with .offset(500) will constantly restart the cursor, causing O(N^2) lag.
      const allActiveScenes = await db.scenes
        .where("[novelId+isActive]")
        .equals([novelId, 1])
        .toArray();

      // Gather original counts concurrently to prevent database lookup delay.
      const originalWordCountPromises = allActiveScenes.map(async (s) => {
        if (!s.versionType || s.versionType === "manual") {
          return { chapterId: s.chapterId, count: s.wordCount };
        }
        // Fetch original version (v1)
        const v1 = await db.scenes
          .where("[activeSceneId+version]")
          .equals([s.id, 1])
          .first();
        return { chapterId: s.chapterId, count: v1 ? v1.wordCount : s.wordCount };
      });
      const originalWordCountsList = await Promise.all(originalWordCountPromises);

      for (const item of originalWordCountsList) {
        chapterOriginalWordCounts.set(
          item.chapterId,
          (chapterOriginalWordCounts.get(item.chapterId) ?? 0) + item.count
        );
      }

      for (const s of allActiveScenes) {
        chapterWordCounts.set(s.chapterId, (chapterWordCounts.get(s.chapterId) ?? 0) + s.wordCount);
        const t = getTimestamp(s.updatedAt);
        const current = latestEditByChapter.get(s.chapterId) || 0;
        if (t > current) {
          latestEditByChapter.set(s.chapterId, t);
        }
        if (s.versionType && s.versionType !== "manual") {
          translatedChapterIds.add(s.chapterId);
        }
      }

      const analysisStatuses = chapters.map((ch) => {
        if (!ch.analyzedAt) return { chapterId: ch.id, status: "unanalyzed" as const };
        const latestEdit = latestEditByChapter.get(ch.id) || 0;
        return {
          chapterId: ch.id,
          status: latestEdit > getTimestamp(ch.analyzedAt) ? "stale" as const : "analyzed" as const,
        };
      });

      return {
        chapterWordCounts,
        chapterOriginalWordCounts,
        analysisStatuses,
        translatedChapterIds,
      };
    },
    [novelId, shouldLoad]
  ) ?? {
    chapterWordCounts: new Map<string, number>(),
    chapterOriginalWordCounts: new Map<string, number>(),
    analysisStatuses: [],
    translatedChapterIds: new Set<string>(),
  };
}

export function useHasAnalyzedChapters(novelId: string | undefined) {
  return useLiveQuery(
    async () => {
      if (!novelId) return false;
      const count = await db.chapters
        .where("novelId")
        .equals(novelId)
        .filter((ch) => !!ch.analyzedAt && !!ch.summary)
        .count();
      return count > 0;
    },
    [novelId],
  );
}

export async function reorderChapters(
  chapters: { id: string; order: number }[]
) {
  await db.transaction("rw", db.chapters, async () => {
    for (const { id, order } of chapters) {
      await db.chapters.update(id, { order, updatedAt: new Date() });
    }
  });
}
