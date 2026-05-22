"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type NameEntry } from "@/lib/db";

// ─── Reads ───────────────────────────────────────────────────

export function useNameEntries(scope: string | undefined) {
  return useLiveQuery(
    () =>
      scope ? db.nameEntries.where("scope").equals(scope).toArray() : [],
    [scope],
  );
}

export function useGlobalNameEntries() {
  return useLiveQuery(
    () => db.nameEntries.where("scope").equals("global").toArray(),
    [],
  );
}

export function useNovelNameEntries(novelId: string | undefined) {
  return useLiveQuery(
    () =>
      novelId
        ? db.nameEntries.where("scope").equals(novelId).toArray()
        : [],
    [novelId],
  );
}

export function useMergedNameEntries(novelId: string | undefined) {
  return useLiveQuery(async () => {
    if (!novelId) return [];
    const [globalEntries, novelEntries] = await Promise.all([
      db.nameEntries.where("scope").equals("global").toArray(),
      db.nameEntries.where("scope").equals(novelId).toArray(),
    ]);
    const merged = new Map<string, NameEntry>();
    for (const e of globalEntries) merged.set(e.chinese, e);
    for (const e of novelEntries) merged.set(e.chinese, e); // override
    return Array.from(merged.values());
  }, [novelId]);
}

export function useNameEntryCount(scope: string | undefined) {
  return useLiveQuery(
    () =>
      scope ? db.nameEntries.where("scope").equals(scope).count() : 0,
    [scope],
  );
}

// ─── Mutations ───────────────────────────────────────────────

export async function createNameEntry(
  data: Omit<NameEntry, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  const id = crypto.randomUUID();
  await db.nameEntries.add({ ...data, id, createdAt: now, updatedAt: now });
  return id;
}

export async function updateNameEntry(
  id: string,
  data: Partial<Omit<NameEntry, "id" | "createdAt">>,
): Promise<void> {
  await db.nameEntries.update(id, { ...data, updatedAt: new Date() });
}

export async function deleteNameEntry(id: string): Promise<void> {
  await db.nameEntries.delete(id);
}

export async function deleteNameEntriesByScope(
  scope: string,
): Promise<void> {
  await db.nameEntries.where("scope").equals(scope).delete();
}

export async function bulkCreateNameEntries(
  entries: Omit<NameEntry, "id" | "createdAt" | "updatedAt">[],
): Promise<void> {
  const now = new Date();
  const rows = entries.map((e) => ({
    ...e,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));
  await db.nameEntries.bulkAdd(rows);
}

export type DuplicateMode = "skip" | "replace";

export interface BulkImportResult {
  added: number;
  skipped: number;
  replaced: number;
}

/**
 * Bulk import name entries with duplicate handling.
 * Duplicates are detected by matching scope + chinese.
 *
 * @param scope - "global" or a novelId
 * @param entries - Array of { chinese, vietnamese } pairs
 * @param category - Category for new entries
 * @param duplicateMode - "skip" keeps existing, "replace" overwrites
 */
export async function bulkImportNameEntries(
  scope: string,
  entries: Array<{ chinese: string; vietnamese: string; category?: string }>,
  defaultCategory: string,
  duplicateMode: DuplicateMode = "skip",
): Promise<BulkImportResult> {
  // Fetch existing entries for this scope in one query
  const existing = await db.nameEntries
    .where("scope")
    .equals(scope)
    .toArray();
  const existingMap = new Map(existing.map((e) => [e.chinese, e]));

  const now = new Date();
  const toAdd: NameEntry[] = [];
  const toUpdate: Array<{ id: string; vietnamese: string; category?: string; updatedAt: Date }> =
    [];
  let skipped = 0;

  // Deduplicate input (last wins within the import set)
  const uniqueEntries = new Map(
    entries.map((e) => [e.chinese, e]),
  );

  for (const [chinese, entry] of uniqueEntries) {
    const vietnamese = entry.vietnamese;
    const itemCategory = entry.category || defaultCategory;
    const ex = existingMap.get(chinese);
    if (ex) {
      if (duplicateMode === "replace") {
        toUpdate.push({ id: ex.id, vietnamese, category: itemCategory, updatedAt: now });
      } else {
        // If mode is "skip", but the existing entry has a generic category ("khác")
        // and the new entry has a specific category, we update the category to improve classifications.
        const isGenericEx = !ex.category || ex.category === "khác";
        const isSpecificNew = itemCategory && itemCategory !== "khác";
        if (isGenericEx && isSpecificNew) {
          toUpdate.push({ id: ex.id, vietnamese: ex.vietnamese, category: itemCategory, updatedAt: now });
        } else {
          skipped++;
        }
      }
    } else {
      toAdd.push({
        id: crypto.randomUUID(),
        scope,
        chinese,
        vietnamese,
        category: itemCategory,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Batch write
  await db.transaction("rw", db.nameEntries, async () => {
    if (toAdd.length > 0) await db.nameEntries.bulkAdd(toAdd);
    for (const u of toUpdate) {
      const updateData: Partial<NameEntry> = {
        vietnamese: u.vietnamese,
        updatedAt: u.updatedAt,
      };
      if (u.category) {
        updateData.category = u.category;
      }
      await db.nameEntries.update(u.id, updateData);
    }
  });

  return {
    added: toAdd.length,
    skipped,
    replaced: toUpdate.length,
  };
}

/** Legacy wrapper — import QT names to global scope */
export async function importQTNamesToGlobal(
  entries: Array<{ chinese: string; vietnamese: string }>,
  category: string,
  duplicateMode: DuplicateMode = "skip",
): Promise<BulkImportResult> {
  return bulkImportNameEntries("global", entries, category, duplicateMode);
}

export async function getMergedNameDict(
  novelId?: string,
): Promise<Array<{ chinese: string; vietnamese: string; category: string }>> {
  const globalEntries = await db.nameEntries
    .where("scope")
    .equals("global")
    .toArray();
  const novelEntries = novelId
    ? await db.nameEntries.where("scope").equals(novelId).toArray()
    : [];
  const merged = new Map<string, { vietnamese: string; category: string }>();
  // Default to "nhân vật" if an entry somehow misses a category, to be safe.
  for (const e of globalEntries) merged.set(e.chinese, { vietnamese: e.vietnamese, category: e.category || "nhân vật" });
  for (const e of novelEntries) merged.set(e.chinese, { vietnamese: e.vietnamese, category: e.category || "nhân vật" });
  return Array.from(merged, ([chinese, data]) => ({
    chinese,
    vietnamese: data.vietnamese,
    category: data.category,
  }));
}
