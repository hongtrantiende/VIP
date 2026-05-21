"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type DictSource, type DictMeta, DICT_GENRES, DICT_TYPES, GENRE_LABELS } from "@/lib/db";


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

async function fetchDictFile(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("text/html")) return null;
    const text = await resp.text();
    if (text.startsWith("<!") || text.slice(0, 100).toLowerCase().includes("<html")) return null;
    return text;
  } catch {
    return null;
  }
}

// ─── Fast Loading (parallel fetch, direct to worker) ─────────

/**
 * Load raw dictionary text strings for direct-to-worker initialization.
 * Returns Record<source, rawText> — NO parsing happens on main thread.
 * This is much faster than loadDictDataForWorker which parses on main thread.
 */
export async function loadRawDictTexts(
  onProgress?: (source: string, percent: number) => void,
): Promise<Record<string, string>> {
  const t0 = performance.now();
  const result: Record<string, string> = {};

  // ── Fast path: read from IndexedDB cache ──
  const cached = await db.dictCache.toArray();
  let isCacheValid = cached.length > 0;
  if (isCacheValid) {
    for (const item of cached) {
      if (item.rawText.startsWith("<!") || item.rawText.slice(0, 100).toLowerCase().includes("<html")) {
        console.warn(`[DictLoader] Cache corruption detected for ${item.source} (contains HTML). Clearing cache.`);
        isCacheValid = false;
        break;
      }
      if (item.source === "core_vietphrase" && item.rawText.length < 500000) {
        console.warn(`[DictLoader] Cache truncation detected for core_vietphrase (too small: ${item.rawText.length} bytes). Clearing cache.`);
        isCacheValid = false;
        break;
      }
    }
  }

  if (!isCacheValid && cached.length > 0) {
    await db.dictCache.clear();
    await db.dictMeta.delete("dict-meta");
    cached.length = 0;
  }

  if (cached.length > 0) {
    for (let i = 0; i < cached.length; i++) {
      result[cached[i].source] = cached[i].rawText;
      onProgress?.(cached[i].source, Math.round(((i + 1) / cached.length) * 100));
    }

    // Re-verify/initialize meta asynchronously if missing or incomplete
    void (async () => {
      try {
        let meta = await db.dictMeta.get("dict-meta");
        if (!meta || Object.keys(meta.sources).length < ALL_SOURCES.length) {
          const counts: Record<string, number> = {};
          for (const item of cached) {
            const lines = item.rawText.split("\n");
            let c = 0;
            for (let j = 0; j < lines.length; j++) {
              if (lines[j].indexOf("=") > 0) c++;
            }
            counts[item.source] = c;
          }
          await db.dictMeta.put({
            id: "dict-meta",
            loadedAt: new Date(),
            sources: counts as DictMeta["sources"],
          });
        }
      } catch (err) {
        console.warn("Failed to initialize dict-meta in background:", err);
      }
    })();

    // Also load override file
    try {
      const overrideText = await fetchDictFile(VIETPHRASE_OVERRIDE_URL, AbortSignal.timeout(3000));
      if (overrideText && result.core_vietphrase) {
        result.core_vietphrase = result.core_vietphrase + "\n" + overrideText;
      }
    } catch { /* optional */ }

    if (cached.length >= ALL_SOURCES.length) {
      onProgress?.("all", 100);
      console.log(`[DictLoader] Raw texts loaded from cache in ${Math.round(performance.now() - t0)}ms`);
      return result;
    }
  }

  // ── Slow path: fetch missing files ──
  const missingSources = ALL_SOURCES.filter(s => !result[s]);
  onProgress?.("all", 0);

  const BATCH_SIZE = 20;
  for (let i = 0; i < missingSources.length; i += BATCH_SIZE) {
    const batch = missingSources.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (source) => {
        const url = DICT_FILES[source];
        try {
          if (source === "core_vietphrase") {
            const text = await fetchDictFile(url, AbortSignal.timeout(3000));
            if (text) return { source, text, ok: true };
            const [t1, t2] = await Promise.all([
              fetchDictFile("/dict/vietphrase_1.txt", AbortSignal.timeout(3000)),
              fetchDictFile("/dict/vietphrase_2.txt", AbortSignal.timeout(3000))
            ]);
            if (t1 && t2) return { source, text: t1 + "\n" + t2, ok: true };
            return { source, text: "", ok: false };
          } else {
            const text = await fetchDictFile(url, AbortSignal.timeout(3000));
            return { source, text: text || "", ok: !!text };
          }
        } catch {
          return { source, text: "", ok: false };
        }
      })
    );

    for (const res of batchResults) {
      if (res.status === "fulfilled" && res.value.ok) {
        result[res.value.source] = res.value.text;
      }
    }

    onProgress?.("all", Math.round(Math.min(i + batch.length, missingSources.length) / missingSources.length * 100));
  }

  // Cache raw texts in background and update counts
  void (async () => {
    try {
      const toCache = missingSources
        .filter(s => result[s])
        .map(s => ({ source: s, rawText: result[s] }));
      if (toCache.length > 0) await db.dictCache.bulkPut(toCache);

      const allCached = await db.dictCache.toArray();
      const counts: Record<string, number> = {};
      for (const item of allCached) {
        const lines = item.rawText.split("\n");
        let c = 0;
        for (let j = 0; j < lines.length; j++) {
          if (lines[j].indexOf("=") > 0) c++;
        }
        counts[item.source] = c;
      }
      await db.dictMeta.put({
        id: "dict-meta",
        loadedAt: new Date(),
        sources: counts as DictMeta["sources"],
      });
    } catch (err) {
      console.warn("Background IDB write failed (non-critical):", err);
    }
  })();

  // Load overrides
  try {
    const resp = await fetch(VIETPHRASE_OVERRIDE_URL, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const overrideText = await resp.text();
      if (overrideText) {
        result.core_vietphrase = (result.core_vietphrase || "") + "\n" + overrideText;
      }
    }
  } catch { /* optional */ }

  console.log(`[DictLoader] Raw texts loaded in ${Math.round(performance.now() - t0)}ms`);
  return result;
}

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
  let isCacheValid = cached.length > 0;
  if (isCacheValid) {
    for (const item of cached) {
      if (item.rawText.startsWith("<!") || item.rawText.slice(0, 100).toLowerCase().includes("<html")) {
        console.warn(`[DictLoader] Cache corruption detected for ${item.source} (contains HTML). Clearing cache.`);
        isCacheValid = false;
        break;
      }
      if (item.source === "core_vietphrase" && item.rawText.length < 500000) {
        console.warn(`[DictLoader] Cache truncation detected for core_vietphrase (too small: ${item.rawText.length} bytes). Clearing cache.`);
        isCacheValid = false;
        break;
      }
    }
  }

  if (!isCacheValid && cached.length > 0) {
    await db.dictCache.clear();
    await db.dictMeta.delete("dict-meta");
    cached.length = 0;
  }

  if (cached.length > 0) {
    const counts: Record<string, number> = {};
    for (let ci = 0; ci < cached.length; ci++) {
      const entry = cached[ci];
      // Báo tiến trình cho UI
      const pct = Math.round((ci / cached.length) * 100);
      onProgress?.(entry.source, pct);
      // Yield SAU MỖI file để UI không bị treo (parseDictText có thể mất trăm ms cho file lớn)
      await new Promise(r => setTimeout(r, 0));

      result[entry.source] = parseDictText(entry.rawText);
      counts[entry.source] = result[entry.source].length;
      sourceCounts[entry.source] = counts[entry.source];
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
          if (source === "core_vietphrase") {
            const text = await fetchDictFile(url, AbortSignal.timeout(3000));
            if (text) return { source, text, ok: true };
            const [t1, t2] = await Promise.all([
              fetchDictFile("/dict/vietphrase_1.txt", AbortSignal.timeout(3000)),
              fetchDictFile("/dict/vietphrase_2.txt", AbortSignal.timeout(3000))
            ]);
            if (t1 && t2) return { source, text: t1 + "\n" + t2, ok: true };
            return { source, text: "", ok: false };
          } else {
            const text = await fetchDictFile(url, AbortSignal.timeout(3000));
            return { source, text: text || "", ok: !!text };
          }
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
      const fetchedText = await fetchDictFile(DICT_FILES[source]);
      if (fetchedText) {
        text = fetchedText;
      } else {
        // Try parts
        const [t1, t2] = await Promise.all([
          fetchDictFile("/dict/vietphrase_1.txt"),
          fetchDictFile("/dict/vietphrase_2.txt")
        ]);
        if (t1 && t2) {
          text = t1 + "\n" + t2;
        }
      }
    } else {
      const fetchedText = await fetchDictFile(DICT_FILES[source]);
      if (fetchedText) {
        text = fetchedText;
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



/** Yield to main thread — uses scheduler.yield() if available (Chrome 129+), else setTimeout */
async function yieldToMain(): Promise<void> {
  if (typeof globalThis !== "undefined" && "scheduler" in globalThis && typeof (globalThis as any).scheduler?.yield === "function") {
    return (globalThis as any).scheduler.yield();
  }
  return new Promise(r => setTimeout(r, 0));
}

export async function appendToDictSource(source: DictSource, entries: { chinese: string; vietnamese: string }[]): Promise<{ added: number, skipped: number }> {
  const cached = await db.dictCache.get(source);
  let currentText = cached?.rawText || "";

  const map = new Map<string, Set<string>>();

  // 1. Load existing entries into map — chunked to avoid blocking main thread
  const lines = currentText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      const meanings = line.slice(eqIdx + 1).split("/").map(m => m.trim()).filter(Boolean);
      if (!map.has(key)) map.set(key, new Set());
      meanings.forEach(m => map.get(key)!.add(m));
    }
    // Yield every 20k lines to keep UI responsive
    if (i > 0 && i % 20_000 === 0) await yieldToMain();
  }

  // 2. Add new entries into map and track what's actually new
  let addedEntriesCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const key = entry.chinese;
    const newMeanings = entry.vietnamese.split("/").map(m => m.trim()).filter(Boolean);

    if (!map.has(key)) {
      map.set(key, new Set(newMeanings));
      addedEntriesCount++;
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
      }
    }
    // Yield every 10k entries
    if (i > 0 && i % 10_000 === 0) await yieldToMain();
  }

  if (addedEntriesCount === 0) {
    // Ensure meta count is present and correct even if no new items were added
    let meta = await db.dictMeta.get("dict-meta");
    if (!meta) {
      meta = { id: "dict-meta", loadedAt: new Date(), sources: {} as Record<DictSource, number> };
    }
    if (!meta.sources[source] || meta.sources[source] !== map.size) {
      meta.sources[source] = map.size;
      meta.loadedAt = new Date();
      await db.dictMeta.put(meta);
    }
    return { added: 0, skipped: entries.length };
  }

  // 3. Rebuild the full text
  const updatedText = Array.from(map.entries())
    .map(([k, vs]) => `${k}=${Array.from(vs).join("/")}`)
    .join("\n") + "\n";

  // 4. Update dictCache with new text (single fast put)
  await db.dictCache.put({ source, rawText: updatedText });

  // dictEntries table bỏ qua — dictCache là nguồn dữ liệu chính.
  // Các hàm saveDictSource & importDictFile đã bỏ dictEntries từ trước.
  // dictEntries chỉ dùng cho search trong splitter-manager, sẽ rebuild lazy khi cần.

  // 5. Update meta count
  let meta = await db.dictMeta.get("dict-meta");
  if (!meta) {
    meta = { id: "dict-meta", loadedAt: new Date(), sources: {} as Record<DictSource, number> };
  }
  meta.sources[source] = map.size;
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
      } catch { }
    }
    result[source] = [];
  }
  await appendOverrides(result);
  return result;
}
