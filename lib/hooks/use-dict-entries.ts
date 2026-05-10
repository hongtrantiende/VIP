"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type DictSource, type DictMeta, DICT_GENRES, DICT_TYPES } from "@/lib/db";

// ─── Reads ───────────────────────────────────────────────────

export function useDictMeta() {
  return useLiveQuery(() => db.dictMeta.get("dict-meta"), []);
}

export async function isDictLoaded(): Promise<boolean> {
  const meta = await db.dictMeta.get("dict-meta");
  return !!meta;
}

// ─── Dict File Parsing ───────────────────────────────────────

export const ALL_SOURCES: DictSource[] = [];
export const DICT_FILES: Record<DictSource, string> = {} as Record<DictSource, string>;

for (const genre of DICT_GENRES) {
  for (const type of DICT_TYPES) {
    const src = `${genre}_${type}` as DictSource;
    ALL_SOURCES.push(src);
    // Determine the URL for the default files
    if (genre === "core") {
       if (type === "tuvung") DICT_FILES[src] = `/dict/khac.txt`;
       else DICT_FILES[src] = `/dict/${type}.txt`;
    } else {
       if (type === "tuvung") DICT_FILES[src] = `/dict/${genre}.txt`;
       else DICT_FILES[src] = `/dict/${genre}_${type}.txt`; 
    }
  }
}

const VIETPHRASE_OVERRIDE_URL = "/dict/vietphrase-override.txt";

function parseDictText(
  text: string,
): Array<{ chinese: string; vietnamese: string }> {
  // Strip BOM
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  const entries: Array<{ chinese: string; vietnamese: string }> = [];

  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const chinese = line.slice(0, idx).trim();
    const vietnamese = line.slice(idx + 1).trim();
    if (chinese && vietnamese) {
      entries.push({ chinese, vietnamese });
    }
  }

  return entries;
}

// ─── Fast Loading (parallel fetch, direct to worker) ─────────

/** Fetch override file and append entries to vietphrase (overrides take priority via Map.set) */
async function appendOverrides(
  result: Record<DictSource, Array<{ chinese: string; vietnamese: string }>>,
): Promise<void> {
  try {
    const resp = await fetch(VIETPHRASE_OVERRIDE_URL);
    if (!resp.ok) return;
    const text = await resp.text();
    const overrides = parseDictText(text);
    if (overrides.length > 0) {
      if (!result.core_vietphrase) result.core_vietphrase = [];
      result.core_vietphrase = [...result.core_vietphrase, ...overrides];
    }
  } catch {
    // Override file is optional — fail silently
  }
}

/**
 * Load dict data optimized for worker initialization.
 * Returns parsed data directly (no IDB roundtrip).
 *
 * Strategy:
 * 1. Check dictCache (5 raw text blobs) — instant
 * 2. If missing, fetch all files in parallel from /dict/
 * 3. Cache raw texts to dictCache for next load
 * 4. Write structured entries to dictEntries in background
 */
export async function loadDictDataForWorker(
  onProgress?: (source: string, percent: number) => void,
): Promise<Record<DictSource, Array<{ chinese: string; vietnamese: string }>>> {
  const result = {} as Record<
    DictSource,
    Array<{ chinese: string; vietnamese: string }>
  >;
  const sourceCounts: Record<string, number> = {};

  // Try reading from dictCache first (5 rows vs 728k rows)
  const cached = await db.dictCache.toArray();
  if (cached.length === ALL_SOURCES.length) {
    // Fast path: parse from cached raw text
    const counts: Record<string, number> = {};
    for (const entry of cached) {
      onProgress?.(entry.source, 0);
      result[entry.source] = parseDictText(entry.rawText);
      counts[entry.source] = result[entry.source].length;
      onProgress?.(entry.source, 100);
    }

    // Ensure dictMeta exists (non-blocking)
    void db.dictMeta.put({
      id: "dict-meta",
      loadedAt: new Date(),
      sources: counts as DictMeta["sources"],
    });

    // Append override entries (higher priority, overwrites base entries via Map.set)
    await appendOverrides(result);
    return result;
  }

  // Slow path: fetch all files in parallel
  onProgress?.("all", 0);

  const fetchResults = await Promise.all(
    ALL_SOURCES.map(async (source) => {
      const url = DICT_FILES[source];
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`Failed to fetch dict file: ${url}`);
        return { source, text: "", ok: false };
      }
      const text = await resp.text();
      return { source, text, ok: true };
    }),
  );

  // Parse all and report progress
  let done = 0;
  for (const { source, text, ok } of fetchResults) {
    if (!ok) {
      result[source] = [];
      sourceCounts[source] = 0;
    } else {
      onProgress?.(source, 0);
      result[source] = parseDictText(text);
      sourceCounts[source] = result[source].length;
    }
    done++;
    const overallPercent = Math.round((done / ALL_SOURCES.length) * 100);
    onProgress?.(source, overallPercent);
  }

  // Cache raw texts for fast future loads (5 rows, non-blocking)
  void (async () => {
    try {
      await db.dictCache.clear();
      await db.dictCache.bulkPut(
        fetchResults
          .filter((r) => r.ok)
          .map((r) => ({ source: r.source, rawText: r.text })),
      );

      // Also write structured entries to dictEntries in background
      // (needed for management UI and name extraction)
      for (const { source, text, ok } of fetchResults) {
        if (!ok) continue;
        const parsed = parseDictText(text);
        await db.dictEntries.where("source").equals(source).delete();
        const CHUNK = 10_000;
        for (let i = 0; i < parsed.length; i += CHUNK) {
          const chunk = parsed.slice(i, i + CHUNK).map((e) => ({
            id: crypto.randomUUID(),
            source: source as DictSource,
            chinese: e.chinese,
            vietnamese: e.vietnamese,
          }));
          await db.dictEntries.bulkAdd(chunk);
        }
      }

      // Write meta
      await db.dictMeta.put({
        id: "dict-meta",
        loadedAt: new Date(),
        sources: sourceCounts as DictMeta["sources"],
      });
    } catch (err) {
      console.warn("Background IDB write failed (non-critical):", err);
    }
  })();

  // Append override entries (higher priority)
  await appendOverrides(result);
  return result;
}

// ─── Legacy Loading (for management UI) ──────────────────────

const CHUNK_SIZE = 10_000;

export async function loadDictFromPublic(
  onProgress?: (source: string, percent: number) => void,
): Promise<void> {
  const sourceCounts: Record<string, number> = {};

  for (const source of ALL_SOURCES) {
    const url = DICT_FILES[source];
    onProgress?.(source, 0);

    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`Failed to fetch dict file: ${url}`);
      sourceCounts[source] = 0;
      continue;
    }

    const text = await resp.text();
    const parsed = parseDictText(text);
    sourceCounts[source] = parsed.length;

    // Clear existing entries for this source
    await db.dictEntries.where("source").equals(source).delete();

    // Bulk insert in chunks
    for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
      const chunk = parsed.slice(i, i + CHUNK_SIZE).map((e) => ({
        id: crypto.randomUUID(),
        source: source as DictSource,
        chinese: e.chinese,
        vietnamese: e.vietnamese,
      }));
      await db.dictEntries.bulkAdd(chunk);
      onProgress?.(
        source,
        Math.min(100, ((i + CHUNK_SIZE) / parsed.length) * 100),
      );
    }

    // Also update dictCache
    await db.dictCache.put({ source, rawText: text });

    onProgress?.(source, 100);
  }

  // Update meta singleton
  await db.dictMeta.put({
    id: "dict-meta",
    loadedAt: new Date(),
    sources: sourceCounts as DictMeta["sources"],
  });
}

export async function importDictFile(
  file: File,
  source: DictSource,
): Promise<number> {
  const text = await file.text();
  const parsed = parseDictText(text);

  // Clear existing entries for this source
  await db.dictEntries.where("source").equals(source).delete();

  // Bulk insert in chunks
  for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
    const chunk = parsed.slice(i, i + CHUNK_SIZE).map((e) => ({
      id: crypto.randomUUID(),
      source,
      chinese: e.chinese,
      vietnamese: e.vietnamese,
    }));
    await db.dictEntries.bulkAdd(chunk);
  }

  // Update dictCache with new raw text
  await db.dictCache.put({ source, rawText: text });

  // Update meta
  const meta = await db.dictMeta.get("dict-meta");
  if (meta) {
    meta.sources[source] = parsed.length;
    meta.loadedAt = new Date();
    await db.dictMeta.put(meta);
  }

  return parsed.length;
}

export async function saveDictSource(source: DictSource, text: string): Promise<number> {
  const parsed = parseDictText(text);

  await db.dictEntries.where("source").equals(source).delete();

  for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
    const chunk = parsed.slice(i, i + CHUNK_SIZE).map((e) => ({
      id: crypto.randomUUID(),
      source,
      chinese: e.chinese,
      vietnamese: e.vietnamese,
    }));
    await db.dictEntries.bulkAdd(chunk);
  }

  await db.dictCache.put({ source, rawText: text });

  const meta = await db.dictMeta.get("dict-meta");
  if (meta) {
    meta.sources[source] = parsed.length;
    meta.loadedAt = new Date();
    await db.dictMeta.put(meta);
  }

  return parsed.length;
}

export async function appendToDictSource(source: DictSource, entries: { chinese: string; vietnamese: string }[]): Promise<number> {
  const cached = await db.dictCache.get(source);
  let currentText = cached?.rawText || "";
  
  // Deduplicate existing keys
  const existingKeys = new Set<string>();
  const lines = currentText.split("\n");
  for (const line of lines) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      existingKeys.add(line.slice(0, eqIdx).trim());
    }
  }

  const newEntries = entries.filter(e => !existingKeys.has(e.chinese));
  if (newEntries.length === 0) return 0;

  if (currentText && !currentText.endsWith("\n")) {
    currentText += "\n";
  }

  const newLines = newEntries.map(e => `${e.chinese}=${e.vietnamese}`).join("\n");
  const newText = currentText + newLines + "\n";

  await saveDictSource(source, newText);
  return newEntries.length;
}

export async function clearDictSource(source: DictSource): Promise<void> {
  await db.dictEntries.where("source").equals(source).delete();
  await db.dictCache.delete(source);
}

/** Deduplicate a dict source — remove entries with the same chinese key, keeping the first occurrence */
export async function deduplicateDictSource(source: DictSource): Promise<number> {
  const cached = await db.dictCache.get(source);
  if (!cached?.rawText) return 0;

  const lines = cached.rawText.split("\n");
  const seen = new Set<string>();
  const dedupedLines: string[] = [];
  let removedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      dedupedLines.push(trimmed);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (seen.has(key)) {
      removedCount++;
      continue;
    }
    seen.add(key);
    dedupedLines.push(trimmed);
  }

  if (removedCount > 0) {
    const newText = dedupedLines.join("\n") + "\n";
    await saveDictSource(source, newText);
  }
  return removedCount;
}

/** Deduplicate ALL dict sources */
export async function deduplicateAllDictSources(): Promise<number> {
  const allSources: DictSource[] = [
    "names", "names2", "vietphrase", "luatnhan", "phienam",
    "ngontinh", "hiendai", "tienhiep", "huyenhuyen", "dammi", "hocduong",
    "nsfw", "hentai", "dongphuong", "dothi", "vongdu", "khoahuyen",
    "quybi", "xuyenkhong", "hethong", "trinhtham", "lichsu"
  ];
  let total = 0;
  for (const source of allSources) {
    total += await deduplicateDictSource(source);
  }
  return total;
}

/** Export a dict source as a downloadable .txt file (chinese=vietnamese per line) */
export async function exportDictSource(source: DictSource): Promise<void> {
  // Try from cache first (fast)
  const cached = await db.dictCache.get(source);
  if (cached) {
    downloadTextFile(`${source}.txt`, cached.rawText);
    return;
  }

  // Fallback: rebuild from entries
  const entries = await db.dictEntries
    .where("source")
    .equals(source)
    .toArray();
  const text = entries.map((e) => `${e.chinese}=${e.vietnamese}`).join("\n");
  downloadTextFile(`${source}.txt`, text);
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Get all dict entries grouped by source for Worker initialization */
export async function getDictEntriesForWorker(): Promise<
  Record<DictSource, Array<{ chinese: string; vietnamese: string }>>
> {
  // Fast path: read from dictCache (5 rows vs 728k rows)
  const cached = await db.dictCache.toArray();
  if (cached.length > 0) {
    const result = {} as Record<
      DictSource,
      Array<{ chinese: string; vietnamese: string }>
    >;
    for (const source of ALL_SOURCES) {
      const entry = cached.find((c) => c.source === source);
      result[source] = entry ? parseDictText(entry.rawText) : [];
    }
    await appendOverrides(result);
    return result;
  }

  // Fallback: read from dictEntries table (slow)
  const result = {} as Record<
    DictSource,
    Array<{ chinese: string; vietnamese: string }>
  >;
  for (const source of ALL_SOURCES) {
    const entries = await db.dictEntries
      .where("source")
      .equals(source)
      .toArray();
    result[source] = entries.map((e) => ({
      chinese: e.chinese,
      vietnamese: e.vietnamese,
    }));
  }
  await appendOverrides(result);
  return result;
}
