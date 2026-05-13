"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type DictSource, type DictMeta, DICT_GENRES, DICT_TYPES } from "@/lib/db";
import { createClient } from "@/lib/supabase/client";

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
    if (genre === "core" && type !== "vietphrase" && type !== "phienam") continue;
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
  const t0 = performance.now();
  const result = {} as Record<
    DictSource,
    Array<{ chinese: string; vietnamese: string }>
  >;
  const sourceCounts: Record<string, number> = {};

  // ── Fast path: read from IndexedDB cache ──
  const cached = await db.dictCache.toArray();
  if (cached.length > 0) {
    const counts: Record<string, number> = {};
    for (let ci = 0; ci < cached.length; ci++) {
      const entry = cached[ci];
      // Báo tiến trình cho UI + nhả main thread để tránh đóng băng
      const pct = Math.round((ci / cached.length) * 100);
      onProgress?.(entry.source, pct);
      // Yield giữa các file lớn để UI không bị treo
      if (ci % 3 === 0) await new Promise(r => setTimeout(r, 0));
      
      result[entry.source] = parseDictText(entry.rawText);
      counts[entry.source] = result[entry.source].length;
    }

    void db.dictMeta.put({
      id: "dict-meta",
      loadedAt: new Date(),
      sources: counts as DictMeta["sources"],
    });

    await appendOverrides(result);

    // Nếu đã nạp đủ từ cache thì return ngay
    if (cached.length >= ALL_SOURCES.length) {
      onProgress?.("all", 100);
      console.log(`[DictLoader] Loaded from cache in ${Math.round(performance.now() - t0)}ms (${cached.length} sources)`);
      return result;
    }
  }

  // ── Slow path: fetch ONLY missing files ──
  const missingSources = ALL_SOURCES.filter(s => !result[s] || result[s].length === 0);
  console.log(`[DictLoader] Fetching ${missingSources.length} missing sources...`);
  onProgress?.("all", 0);

  const BATCH_SIZE = 20; // Tải 20 file cùng lúc
  const fetchResults: Array<{ source: DictSource; text: string; ok: boolean }> = [];

  for (let i = 0; i < missingSources.length; i += BATCH_SIZE) {
    const batch = missingSources.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (source) => {
        const url = DICT_FILES[source];
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (!resp.ok) return { source, text: "", ok: false };
          const text = await resp.text();
          return { source, text, ok: true };
        } catch {
          return { source, text: "", ok: false };
        }
      })
    );

    for (const res of batchResults) {
      if (res.status === "fulfilled") {
        fetchResults.push(res.value);
      }
    }

    const overallPercent = Math.round(Math.min(i + batch.length, missingSources.length) / missingSources.length * 100);
    onProgress?.("all", overallPercent);
  }

  // Parse results
  for (const { source, text, ok } of fetchResults) {
    if (ok && text) {
      result[source] = parseDictText(text);
      sourceCounts[source] = result[source].length;
    } else if (!result[source]) {
      result[source] = [];
      sourceCounts[source] = 0;
    }
  }

  // Cache raw texts for next load (non-blocking)
  void (async () => {
    try {
      const toCache = fetchResults
        .filter(r => r.ok && r.text)
        .map(r => ({ source: r.source, rawText: r.text }));
      if (toCache.length > 0) {
        await db.dictCache.bulkPut(toCache);
      }
      await db.dictMeta.put({
        id: "dict-meta",
        loadedAt: new Date(),
        sources: sourceCounts as DictMeta["sources"],
      });
    } catch (err) {
      console.warn("Background IDB write failed (non-critical):", err);
    }
  })();

  await appendOverrides(result);
  console.log(`[DictLoader] Full load done in ${Math.round(performance.now() - t0)}ms`);
  return result;
}

// ─── Legacy Loading (for management UI) ──────────────────────

const CHUNK_SIZE = 10_000;

export async function loadDictFromPublic(
  onProgress?: (source: string, percent: number) => void,
): Promise<void> {
  const sourceCounts: Record<string, number> = {};

  for (const source of ALL_SOURCES) {
    onProgress?.(source, 0);
    let text = "";

    if (source === "core_vietphrase") {
      const resp = await fetch(DICT_FILES[source]);
      if (resp.ok) {
        text = await resp.text();
      } else {
        // Try parts
        const [r1, r2] = await Promise.all([
          fetch("/dict/vietphrase_1.txt"),
          fetch("/dict/vietphrase_2.txt")
        ]);
        if (r1.ok && r2.ok) {
          text = (await r1.text()) + "\n" + (await r2.text());
        }
      }
    } else {
      const resp = await fetch(DICT_FILES[source]);
      if (resp.ok) {
        text = await resp.text();
      }
    }

    if (!text) {
      console.warn(`Failed to fetch dict file for: ${source}`);
      sourceCounts[source] = 0;
      continue;
    }

    const parsed = parseDictText(text);
    sourceCounts[source] = parsed.length;

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

  // Removed dictEntries insert to make it instant

  // Update dictCache with new raw text
  await db.dictCache.put({ source, rawText: text });

  let meta = await db.dictMeta.get("dict-meta");
  if (!meta) {
    meta = { id: "dict-meta", loadedAt: new Date(), sources: {} as Record<DictSource, number> };
  }
  meta.sources[source] = parsed.length;
  meta.loadedAt = new Date();
  await db.dictMeta.put(meta);

  return parsed.length;
}

export async function saveDictSource(source: DictSource, text: string): Promise<number> {
  const parsed = parseDictText(text);

  // Removed dictEntries insert to make it instant

  await db.dictCache.put({ source, rawText: text });

  let meta = await db.dictMeta.get("dict-meta");
  if (!meta) {
    meta = { id: "dict-meta", loadedAt: new Date(), sources: {} as Record<DictSource, number> };
  }
  meta.sources[source] = parsed.length;
  meta.loadedAt = new Date();
  await db.dictMeta.put(meta);

  return parsed.length;
}
export async function uploadToCommunityDict(
  entries: { chinese: string; vietnamese: string; category: string }[],
  novelGenre: string = "tienhiep"
) {
  try {
    const supabase = createClient();
    const rows = entries.map(e => ({
      chinese: e.chinese,
      vietnamese: e.vietnamese,
      category: e.category,
      novel_genre: novelGenre
    }));
    await supabase.from("community_dict_entries").insert(rows);
  } catch (err) {
    console.error("Lỗi đẩy lên từ điển cộng đồng:", err);
  }
}

export async function appendToDictSource(source: DictSource, entries: { chinese: string; vietnamese: string }[]): Promise<number> {
  const cached = await db.dictCache.get(source);
  let currentText = cached?.rawText || "";
  
  // Deduplicate against existing keys
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

  // Also deduplicate within new entries themselves
  const seenNew = new Set<string>();
  const uniqueNewEntries = newEntries.filter(e => {
    if (seenNew.has(e.chinese)) return false;
    seenNew.add(e.chinese);
    return true;
  });
  if (uniqueNewEntries.length === 0) return 0;

  // 1. Append new lines to cache text (fast, O(k))
  if (currentText && !currentText.endsWith("\n")) {
    currentText += "\n";
  }
  const newLines = uniqueNewEntries.map(e => `${e.chinese}=${e.vietnamese}`).join("\n");
  const updatedText = currentText + newLines + "\n";
  
  // 2. Update dictCache with new text (1 IDB write)
  await db.dictCache.put({ source, rawText: updatedText });

  // Removed dictEntries insert to make it instant

  // 4. Update meta count (1 IDB write)
  let meta = await db.dictMeta.get("dict-meta");
  if (!meta) {
    meta = { id: "dict-meta", loadedAt: new Date(), sources: {} as Record<DictSource, number> };
  }
  meta.sources[source] = (meta.sources[source] || 0) + uniqueNewEntries.length;
  meta.loadedAt = new Date();
  await db.dictMeta.put(meta);

  return uniqueNewEntries.length;
}

export async function clearDictSource(source: DictSource): Promise<void> {
  // Wipe all entries related to this source
  await db.dictEntries.where("source").equals(source).delete(); // Clean up old data to free disk space
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
  let total = 0;
  for (const source of ALL_SOURCES) {
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

  // Fallback: parse raw text from API if cache misses
  const url = DICT_FILES[source];
  if (url) {
    const resp = await fetch(url);
    if (resp.ok) {
      const text = await resp.text();
      downloadTextFile(`${source}.txt`, text);
      return;
    }
  }
  throw new Error(`Could not export dict source: ${source}`);
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

  // Fallback if no cache
  const result = {} as Record<
    DictSource,
    Array<{ chinese: string; vietnamese: string }>
  >;
  for (const source of ALL_SOURCES) {
    const url = DICT_FILES[source];
    if (url) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          result[source] = parseDictText(await resp.text());
          continue;
        }
      } catch {}
    }
    result[source] = [];
  }
  await appendOverrides(result);
  return result;
}
