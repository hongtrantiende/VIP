"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type SceneVersionType } from "@/lib/db";

export const MAX_VERSIONS = 10;

/** Reactive query: all inactive versions for a scene, newest first. */
export function useSceneVersions(sceneId: string | undefined) {
  return useLiveQuery(
    async () => {
      if (!sceneId) return [];
      const versions = await db.scenes
        .where("activeSceneId")
        .equals(sceneId)
        .sortBy("version");
      return versions.reverse(); // newest first
    },
    [sceneId],
  );
}

/**
 * Create a new version (inactive Scene row) for the given active scene.
 * Returns the new version's ID, or null if limit reached.
 */
export async function createSceneVersion(
  sceneId: string,
  novelId: string,
  type: SceneVersionType,
  content: string,
): Promise<string | null> {
  return db.transaction("rw", db.scenes, async () => {
    const existing = await db.scenes
      .where("activeSceneId")
      .equals(sceneId)
      .toArray();

    if (existing.length >= MAX_VERSIONS) return null;

    const nextVersion =
      existing.length === 0
        ? 1
        : Math.max(...existing.map((v) => v.version)) + 1;

    const activeScene = await db.scenes.get(sceneId);
    if (!activeScene) return null;

    const id = crypto.randomUUID();
    await db.scenes.add({
      id,
      chapterId: activeScene.chapterId,
      novelId,
      title: activeScene.title,
      content,
      order: activeScene.order,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      version: nextVersion,
      versionType: type,
      isActive: 0,
      activeSceneId: sceneId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  });
}

/**
 * Bootstrap v1 (manual) if a scene has no versions yet.
 * Skips if versions already exist or content is empty.
 */
export async function ensureInitialVersion(
  sceneId: string,
  novelId: string,
  content: string,
): Promise<void> {
  if (!content || !content.trim()) return;
  // Atomic check-then-create to prevent duplicate v1 under concurrency
  await db.transaction("rw", db.scenes, async () => {
    const count = await db.scenes
      .where("activeSceneId")
      .equals(sceneId)
      .count();
    if (count > 0) return;

    const activeScene = await db.scenes.get(sceneId);
    if (!activeScene) return;

    await db.scenes.add({
      id: crypto.randomUUID(),
      chapterId: activeScene.chapterId,
      novelId,
      title: activeScene.title,
      content,
      order: activeScene.order,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      version: 1,
      versionType: "manual",
      isActive: 0,
      activeSceneId: sceneId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

/**
 * Get the ORIGINAL content of a scene (pre-translation).
 * Looks for the first version (v1 / "manual") snapshot.
 * If no versions exist, returns the current scene content (it IS the original).
 */
export async function getOriginalContent(sceneId: string): Promise<string> {
  // Look for version 1 (the "manual" / original snapshot)
  const versions = await db.scenes
    .where("activeSceneId")
    .equals(sceneId)
    .sortBy("version");

  if (versions.length > 0) {
    // v1 is the original content saved before any translation
    const v1 = versions[0];
    if (v1.content?.trim()) return v1.content;
  }

  // No versions exist → current content IS the original
  const scene = await db.scenes.get(sceneId);
  return scene?.content ?? "";
}

/** Delete a single version (inactive scene) by ID. */
export async function deleteSceneVersion(id: string): Promise<void> {
  await db.scenes.delete(id);
}

/** Delete multiple versions by IDs. */
export async function deleteSceneVersions(ids: string[]): Promise<void> {
  await db.scenes.bulkDelete(ids);
}

/** Delete all versions for a scene. */
export async function deleteAllSceneVersions(sceneId: string): Promise<void> {
  await db.scenes.where("activeSceneId").equals(sceneId).delete();
}

/** 
 * Revert translations for multiple chapters:
 * Deletes all inactive versions (translations) and restores the original manual content
 * as the active scene.
 */
export async function clearChapterTranslations(chapterIds: string[]): Promise<void> {
  await db.transaction("rw", [db.scenes], async () => {
    for (const chapterId of chapterIds) {
      // Find the active scene for this chapter
      const activeScenes = await db.scenes
        .where("[chapterId+isActive]")
        .equals([chapterId, 1])
        .toArray();
        
      if (activeScenes.length === 0) continue;
      const activeScene = activeScenes[0];

      // Get original content (v1/manual)
      const versions = await db.scenes
        .where("activeSceneId")
        .equals(activeScene.id)
        .sortBy("version");
        
      let originalContent = activeScene.content;
      if (versions.length > 0) {
        const v1 = versions[0];
        if (v1.content?.trim()) {
          originalContent = v1.content;
        }
      }
      
      // Delete all inactive versions
      await db.scenes.where("activeSceneId").equals(activeScene.id).delete();
      
      // Update the active scene to be manual and contain original text
      await db.scenes.update(activeScene.id, {
        content: originalContent,
        version: 1,
        versionType: "manual",
        wordCount: originalContent.split(/\s+/).filter(Boolean).length,
        updatedAt: new Date()
      });
    }
  });
}
