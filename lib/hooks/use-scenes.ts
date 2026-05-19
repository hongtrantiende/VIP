"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type Scene } from "@/lib/db";

export function useScenes(chapterId: string | undefined) {
  const scenes = useLiveQuery(
    () =>
      chapterId
        ? db.scenes
          .where("[chapterId+isActive]")
          .equals([chapterId, 1])
          .sortBy("order")
        : [],
    [chapterId],
  );
  return scenes;
}

/** Reactive query: all original (version 1, manual) versions for a chapter's scenes. */
export function useOriginalScenes(chapterId: string | undefined) {
  const originalScenes = useLiveQuery(
    async () => {
      if (!chapterId) return [];
      // 1. Get all active scenes for this chapter
      const activeScenes = await db.scenes
        .where("[chapterId+isActive]")
        .equals([chapterId, 1])
        .sortBy("order");

      if (activeScenes.length === 0) return [];

      // 2. Bulk-fetch ALL inactive versions for these active scene IDs at once
      //    This avoids the N+1 query pattern that caused slowdowns.
      const activeIds = activeScenes.map((s) => s.id);
      const allVersions = await db.scenes
        .where("activeSceneId")
        .anyOf(activeIds)
        .filter((s) => s.version === 1 && s.versionType === "manual")
        .toArray();

      // Build a lookup map: activeSceneId → original version
      const originalMap = new Map<string, typeof allVersions[0]>();
      for (const v of allVersions) {
        if (v.activeSceneId) originalMap.set(v.activeSceneId, v);
      }

      // 3. For each active scene, use the original or fall back to itself
      return activeScenes.map((active) => originalMap.get(active.id) || active);
    },
    [chapterId],
  );
  return originalScenes;
}

export function useNovelScenes(novelId: string | undefined) {
  const scenes = useLiveQuery(
    () =>
      novelId
        ? db.scenes
          .where("[novelId+isActive]")
          .equals([novelId, 1])
          .sortBy("order")
        : [],
    [novelId],
  );
  return scenes;
}

export function useScene(id: string | undefined) {
  const scene = useLiveQuery(
    () => (id ? db.scenes.get(id) : undefined),
    [id],
  );
  return scene;
}

export function useNovelWordCount(novelId: string | undefined) {
  const wordCount = useLiveQuery(
    async () => {
      if (!novelId) return 0;
      let sum = 0;
      await db.scenes
        .where("[novelId+isActive]")
        .equals([novelId, 1])
        .each((s) => { sum += s.wordCount; });
      return sum;
    },
    [novelId],
  );
  return wordCount ?? 0;
}

export function useChapterWordCounts(novelId: string | undefined) {
  return useLiveQuery(
    async () => {
      const map = new Map<string, number>();
      if (!novelId) return map;
      await db.scenes
        .where("[novelId+isActive]")
        .equals([novelId, 1])
        .each((s) => {
          map.set(s.chapterId, (map.get(s.chapterId) ?? 0) + s.wordCount);
        });
      return map;
    },
    [novelId]
  ) ?? new Map<string, number>();
}

export async function createScene(
  data: Omit<Scene, "id" | "wordCount" | "createdAt" | "updatedAt" | "version" | "versionType" | "isActive" | "activeSceneId">,
) {
  const now = new Date();
  const id = crypto.randomUUID();
  const wordCount = data.content.split(/\s+/).filter(Boolean).length;
  await db.scenes.add({
    ...data,
    id,
    wordCount,
    version: 0,
    versionType: "manual",
    isActive: 1,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateScene(
  id: string,
  data: Partial<Omit<Scene, "id" | "createdAt">>,
) {
  const updates: Partial<Scene> = { ...data, updatedAt: new Date() };
  if (data.content !== undefined) {
    updates.wordCount = data.content.split(/\s+/).filter(Boolean).length;
  }
  await db.scenes.update(id, updates);
}

export async function deleteScene(id: string) {
  await db.transaction("rw", db.scenes, async () => {
    // Delete all inactive versions pointing to this scene
    await db.scenes.where("activeSceneId").equals(id).delete();
    await db.scenes.delete(id);
  });
}

export async function reorderScenes(
  scenes: { id: string; order: number }[],
) {
  await db.transaction("rw", db.scenes, async () => {
    for (const { id, order } of scenes) {
      await db.scenes.update(id, { order, updatedAt: new Date() });
    }
  });
}
