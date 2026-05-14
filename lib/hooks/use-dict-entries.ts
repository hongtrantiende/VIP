"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type DictSource, type DictMeta, DICT_GENRES, DICT_TYPES, GENRE_LABELS } from "@/lib/db";
import { submitCommunityDictAction } from "@/app/actions/dict-upload";

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
      sourceCounts[entry.source] = counts[entry.source]; // Keep track of cached counts!
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
          let resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (!resp.ok && source === "core_vietphrase") {
            // Fallback for large vietphrase file
            const [r1, r2] = await Promise.all([
              fetch("/dict/vietphrase_1.txt", { signal: AbortSignal.timeout(3000) }),
              fetch("/dict/vietphrase_2.txt", { signal: AbortSignal.timeout(3000) })
            ]);
            if (r1.ok && r2.ok) {
              const text1 = await r1.text();
              const text2 = await r2.text();
              return { source, text: text1 + "\n" + text2, ok: true };
            }
            return { source, text: "", ok: false };
          }
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
export function normalizeGenre(genre: string): string {
  if (!genre) return "tienhiep";
  const gLower = genre.toLowerCase();
  
  // 1. Check if it's already a valid key
  for (const key of DICT_GENRES) {
    if (gLower === key) return key;
  }

  // 2. Check if it's a source name like "tienhiep_names"
  for (const key of DICT_GENRES) {
    if (gLower.startsWith(key + "_")) return key;
  }

  // 3. Check if it's a Vietnamese label like "Tiên hiệp"
  for (const [key, label] of Object.entries(GENRE_LABELS)) {
    if (gLower === label.toLowerCase() || gLower.includes(label.toLowerCase())) return key;
  }

  return "tienhiep";
}

export async function uploadToCommunityDict(
  entries: { chinese: string; vietnamese: string; category: string }[],
  novelGenre: string = "tienhiep"
) {
  if (!entries || entries.length === 0) return;
  
  try {
    const genre = normalizeGenre(novelGenre);
    
    // Group entries by dictionary type to upload to correct files
    const groups: Record<string, typeof entries> = {
      "names": [],
      "tuvung": [],
      "ngucanh": []
    };

    for (const e of entries) {
      if (e.category === "nhân vật") groups.names.push(e);
      else if (e.category === "thuật ngữ") groups.tuvung.push(e);
      else groups.ngucanh.push(e);
    }

    const timestamp = Date.now();
    
    for (const [type, groupEntries] of Object.entries(groups)) {
      if (groupEntries.length === 0) continue;
      
      const content = groupEntries.map(e => `${e.chinese}=${e.vietnamese}`).join("\n");
      // Use "user_dict_" prefix so CommunityDictionary.tsx can parse it correctly
      const filename = `user_dict_${genre}_${type}_${timestamp}.txt`;
      
      await submitCommunityDictAction(genre, filename, content);
    }
  } catch (err) {
    console.error("Lỗi đẩy lên từ điển cộng đồng (Drive):", err);
  }
}

export async function appendToDictSource(source: DictSource, entries: { chinese: string; vietnamese: string }[]): Promise<{ added: number, skipped: number }> {
  const cached = await db.dictCache.get(source);
  let currentText = cached?.rawText || "";
  
  const map = new Map<string, Set<string>>();
  
  // 1. Load existing entries into map
  const lines = currentText.split("\n");
  for (const line of lines) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      const meanings = line.slice(eqIdx + 1).split("/").map(m => m.trim()).filter(Boolean);
      if (!map.has(key)) map.set(key, new Set());
      meanings.forEach(m => map.get(key)!.add(m));
    }
  }

  // 2. Add new entries into map and track what's actually new
  let addedEntriesCount = 0;
  const uniqueNewEntries: { chinese: string; vietnamese: string }[] = [];

  for (const entry of entries) {
    const key = entry.chinese;
    const newMeanings = entry.vietnamese.split("/").map(m => m.trim()).filter(Boolean);
    
    if (!map.has(key)) {
      map.set(key, new Set(newMeanings));
      addedEntriesCount++;
      uniqueNewEntries.push({ chinese: key, vietnamese: newMeanings.join("/") });
    } else {
      const existingMeanings = map.get(key)!;
      let hasNewMeaning = false;
      for (const m of newMeanings) {
        if (!existingMeanings.has(m)) {
          existingMeanings.add(m);
          hasNewMeaning = true;
        }
      }
      if (hasNewMeaning) {
        addedEntriesCount++;
        // We track this as "added" because it was modified
      }
    }
  }

  if (addedEntriesCount === 0) {
    return { added: 0, skipped: entries.length };
  }

  // 3. Rebuild the full text
  const updatedText = Array.from(map.entries())
    .map(([k, vs]) => `${k}=${Array.from(vs).join("/")}`)
    .join("\n") + "\n";
  
  // 2. Update dictCache with new text
  await db.dictCache.put({ source, rawText: updatedText });

  // 3. Update dictEntries (structured table for search)
  // Since we merged, it's safer to clear and rebuild if the change is large, 
  // but for performance with append, we only add actually new keys or update modified ones.
  // For simplicity and speed in this append-style function, we'll just update the modified ones.
  // BUT: dictEntries is for SEARCH, it doesn't need to be 100% perfect for every slash.
  // To keep it simple, we'll just add the NEW entries as before.
  try {
    const entriesToUpdate = Array.from(map.entries())
      .filter(([k]) => entries.some(e => e.chinese === k)) // only those we touched
      .map(([k, vs]) => ({
        id: crypto.randomUUID(),
        source,
        chinese: k,
        vietnamese: Array.from(vs).join("/")
      }));
    
    // Clear old entries for these keys first to avoid duplicates in search
    const keysToClear = entriesToUpdate.map(e => e.chinese);
    await db.dictEntries.where("chinese").anyOf(keysToClear).and(e => e.source === source).delete();
    await db.dictEntries.bulkAdd(entriesToUpdate);
  } catch (err) {
    console.warn("[appendToDictSource] Failed to update dictEntries table:", err);
  }

  // 4. Update meta count (Recalculate based on actual lines in cache for accuracy)
  let meta = await db.dictMeta.get("dict-meta");
  if (!meta) {
    meta = { id: "dict-meta", loadedAt: new Date(), sources: {} as Record<DictSource, number> };
  }
  
  // Count lines that look like valid entries
  const totalEntries = map.size;
  meta.sources[source] = totalEntries;
  meta.loadedAt = new Date();
  await db.dictMeta.put(meta);

  return { added: addedEntriesCount, skipped: entries.length - addedEntriesCount };
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
