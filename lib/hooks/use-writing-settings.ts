"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type WritingSettings } from "@/lib/db";

export function useWritingSettings(novelId: string | undefined) {
  return useLiveQuery(
    () => (novelId ? db.writingSettings.get(novelId) : undefined),
    [novelId],
  );
}

export async function getOrCreateWritingSettings(
  novelId: string,
): Promise<WritingSettings> {
  const existing = await db.writingSettings.get(novelId);
  if (existing) return existing;

  const now = new Date();
  const settings: WritingSettings = {
    id: novelId,
    chapterLength: 3000,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.writingSettings.add(settings);
  } catch (err) {
    // If the writing settings were added concurrently by another call, fetch and return them
    const existingAgain = await db.writingSettings.get(novelId);
    if (existingAgain) return existingAgain;
    throw err;
  }
  return settings;
}

export async function updateWritingSettings(
  novelId: string,
  data: Partial<Omit<WritingSettings, "id" | "createdAt">>,
) {
  await db.writingSettings.update(novelId, {
    ...data,
    updatedAt: new Date(),
  });
}
