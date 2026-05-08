import { sanitizeText } from "../utils";
import { extensionFetch, extensionDownloadSTVChapter, extensionStopScrape } from "./extension-bridge";
import type { ChapterContent, ChapterLink, SiteAdapter } from "./types";

/** Simple content hash for duplicate detection */
function hashContent(text: string): string {
  let hash = 0;
  const str = text.replace(/\s+/g, '').slice(0, 2000); // Normalize whitespace, use first 2000 chars
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit int
  }
  return hash.toString(36);
}

/** Check similarity between two texts (0-1 ratio) */
function contentSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const normA = a.replace(/\s+/g, ' ').trim();
  const normB = b.replace(/\s+/g, ' ').trim();
  if (normA === normB) return 1;
  // Quick length-based check
  const lenRatio = Math.min(normA.length, normB.length) / Math.max(normA.length, normB.length);
  if (lenRatio < 0.5) return 0; // Too different in length
  // Compare first/last chunks
  const chunkSize = Math.min(500, normA.length, normB.length);
  const headA = normA.slice(0, chunkSize);
  const headB = normB.slice(0, chunkSize);
  const tailA = normA.slice(-chunkSize);
  const tailB = normB.slice(-chunkSize);
  let matches = 0;
  if (headA === headB) matches++;
  if (tailA === tailB) matches++;
  return matches / 2;
}

export function sanitizeChapterContent(c: ChapterContent): ChapterContent {
  return {
    ...c,
    title: sanitizeText(c.title),
    content: sanitizeText(c.content, true),
  };
}

export interface ScrapeDebugEntry {
  chapterTitle: string;
  url: string;
  htmlLength: number;
  parsed: ChapterContent;
  extensionLogs?: string[];
  timedOut: boolean;
  contentTextLength: number;
  waitSelector?: string;
  clickSelector?: string;
}

/**
 * Scrape selected chapters sequentially through the extension.
 */
export async function scrapeChapters(
  chapters: ChapterLink[],
  adapter: SiteAdapter,
  onProgress?: (completed: number, total: number, currentTitle: string) => void,
  signal?: AbortSignal,
  onDebug?: (entry: ScrapeDebugEntry) => void,
  delayMs: number = 300,
  onPauseCheck?: () => boolean,
  onDynamicChapterAdded?: (newChapter: ChapterLink) => void,
): Promise<ChapterContent[]> {
  const results: ChapterContent[] = [];
  const contentHashes = new Set<string>();
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;

    const safeDelayMs = Math.max(adapter.minDelayMs || delayMs || 7000, 100);

    for (let i = 0; i < chapters.length; i++) {
      signal?.throwIfAborted();

      // Wait BEFORE starting the next chapter to ensure tab switching is synced with delay
      if (i > 0) {
        await delay(safeDelayMs);
      }

      const chapter = chapters[i];
      onProgress?.(i + 1, chapters.length, chapter.title);

      // Pause loop
      while (onPauseCheck?.()) {
        await delay(1000);
        signal?.throwIfAborted();
      }

      let html = "";
      let contentText: string | undefined = undefined;
      let timedOut = false;
      let logs: string[] = [];
      let extTitle: string | undefined = undefined;
      let content: ChapterContent = { title: "", content: "" };

      let attempts = 0;
      let success = false;
      let lastError: any = null;

      while (attempts < 3 && !success) {
        try {
          if ((adapter.name === "STV" || adapter.name === "Fanqie Novel") && chapter.id) {
            const res = await extensionDownloadSTVChapter(
              chapter.id,
              chapter.url,
              i < chapters.length - 1 && !signal?.aborted,
            );
            html = res.data ?? "";
            contentText = (res as any).contentText ?? res.content ?? undefined;
            timedOut = (res as any).timedOut ?? false;
            extTitle = res.title;
            if (res.stopped) break;
          } else {
            const fetchRes = await extensionFetch(chapter.url, {
              waitSelector: adapter.chapterWaitSelector,
              clickSelector: adapter.chapterClickSelector,
              reuseTab: adapter.useSequentialTab,
            });
            html = fetchRes.html;
            contentText = fetchRes.contentText;
            timedOut = fetchRes.timedOut ?? false;
            logs = fetchRes.logs ?? [];
          }

        content = sanitizeChapterContent(
          await adapter.getChapterContent(html, chapter.url, contentText),
        );
        content.order = chapter.order;

        if (!content.title || content.title.trim() === "") {
          content.title = extTitle || chapter.title;
        }

        if ((timedOut || content.content.length < 30) && adapter.name !== "STV") {
          throw new Error(`Lỗi lấy nội dung: Timeout hoặc quá ngắn (${content.content.length} ký tự)`);
        }

        success = true;
      } catch (err: any) {
        lastError = err;
        attempts++;
        if (attempts >= 3 || adapter.name === "STV") {
          break;
        }
        await delay(1500 * attempts);
      }
    }

    if (!success && lastError && adapter.name !== "STV") {
      throw lastError; // Bubble up after 3 attempts
    }

    // ── Duplicate detection (all adapters) ──
    const currentHash = hashContent(content.content);
    if (contentHashes.has(currentHash) && content.content.length > 100) {
      content.warning = `⚠️ Nội dung trùng lặp với chương trước (hash giống hệt). Có thể trang chưa load kịp.`;
      consecutiveErrors++;
    } else if (i > 0 && results.length > 0) {
      const similarity = contentSimilarity(content.content, results[results.length - 1].content);
      if (similarity >= 0.8 && content.content.length > 100) {
        content.warning = `⚠️ Nội dung giống ~${Math.round(similarity * 100)}% chương trước. Có thể bị trùng.`;
        consecutiveErrors++;
      } else {
        consecutiveErrors = 0; // Reset counter on success
      }
    } else {
      consecutiveErrors = 0;
    }
    contentHashes.add(currentHash);

    if (timedOut) {
      content.warning = `Timeout — nội dung chưa load được (${content.content.length} ký tự)`;
      consecutiveErrors++;
    } else if (content.content.length < 30) {
      content.warning = `Nội dung quá ngắn (${content.content.length} ký tự)`;
      consecutiveErrors++;
    }

    results.push(content);

    onDebug?.({
      chapterTitle: chapter.title,
      url: chapter.url,
      htmlLength: html.length,
      parsed: content,
      extensionLogs: logs,
      timedOut: timedOut ?? false,
      contentTextLength: contentText?.length ?? 0,
      waitSelector: adapter.chapterWaitSelector,
      clickSelector: adapter.chapterClickSelector,
    });

    // For STV, stop IMMEDIATELY if content is missing or too short
    if (adapter.name === "STV" && (timedOut || content.content.length < 30)) {
      await extensionStopScrape();
      const chNumMatch = chapter.title.match(/(\d+)/);
      const chNum = chNumMatch ? `số ${chNumMatch[0]}` : "";
      throw new Error(
        `STV_RESUME_REQUIRED|${chapter.title}|Vui lòng mở Tab SangTacViet, vào đúng chương ${chNum} ("${chapter.title}") và đảm bảo nội dung đã hiển thị, sau đó quay lại đây bấm "Tiếp tục".`,
      );
    }

    // Auto-stop after consecutive errors (any adapter)
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      await extensionStopScrape();
      throw new Error(
        `Đã dừng: ${MAX_CONSECUTIVE_ERRORS} chương liên tiếp có vấn đề (trùng/lỗi/ngắn). Kiểm tra lại trang nguồn.`,
      );
    }

    // ── Dynamic Next Chapter Crawling ──
      // If we just processed the last chapter in our list, and it gave us a next link
      if (i === chapters.length - 1 && content.nextChapterUrl) {
        // Make sure we haven't seen it yet
        const alreadyExists = chapters.some((ch) => ch.url === content.nextChapterUrl);
        if (!alreadyExists && content.nextChapterUrl.startsWith("http")) {
          const newChapter: ChapterLink = {
            title: `Chương ${chapters.length + 1} (Đang lấy tiêu đề...)`,
            url: content.nextChapterUrl,
            order: chapters.length,
          };
          chapters.push(newChapter);
          onDynamicChapterAdded?.(newChapter);
        }
      }
    }

    await extensionStopScrape();
    // Close any persistent tab created during scraping
    try {
      const { extensionId } = await import("./extension-bridge");
      if (chrome?.runtime) {
        chrome.runtime.sendMessage(extensionId, { action: "closePersistentTab" });
      }
    } catch {}

    onProgress?.(chapters.length, chapters.length, "");
    return results;
}

export async function crawlNovel(
  startUrl: string,
  adapter: SiteAdapter,
  onChapterScraped: (content: ChapterContent, url: string) => Promise<void>,
  onProgress?: (completed: number, currentTitle: string) => void,
  signal?: AbortSignal,
  delayMs: number = 2000,
  onPauseCheck?: () => boolean,
): Promise<void> {
  let currentUrl = startUrl;
  let completed = 0;

  while (currentUrl) {
    signal?.throwIfAborted();

    // Pause loop
    while (onPauseCheck?.()) {
      await delay(1000);
      signal?.throwIfAborted();
    }

    const fetchRes = await extensionFetch(currentUrl, {
      waitSelector: adapter.chapterWaitSelector,
      clickSelector: adapter.chapterClickSelector,
    });

    const content = sanitizeChapterContent(
      await adapter.getChapterContent(fetchRes.html, currentUrl, fetchRes.contentText),
    );

    onProgress?.(++completed, content.title || "Chương không rõ");
    
    await onChapterScraped(content, currentUrl);

    currentUrl = content.nextChapterUrl || "";
    
    if (currentUrl) {
      await delay(delayMs);
    }
  }
}

/**
 * Server-side chapter scraping — fetches chapters via /api/scrape (no extension needed).
 * Compatible with the same callback interface as scrapeChapters.
 */
export async function serverScrapeChapters(
  chapters: ChapterLink[],
  onProgress?: (completed: number, total: number, currentTitle: string) => void,
  signal?: AbortSignal,
  onDebug?: (entry: ScrapeDebugEntry) => void,
  delayMs: number = 1000,
  onPauseCheck?: () => boolean,
  onDynamicChapterAdded?: (newChapter: ChapterLink) => void,
): Promise<ChapterContent[]> {
  const results: ChapterContent[] = [];
  const contentHashes = new Set<string>();
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  const safeDelayMs = Math.max(delayMs, 300);

  for (let i = 0; i < chapters.length; i++) {
    signal?.throwIfAborted();

    if (i > 0) {
      await delay(safeDelayMs);
    }

    const chapter = chapters[i];
    onProgress?.(i + 1, chapters.length, chapter.title);

    // Pause loop
    while (onPauseCheck?.()) {
      await delay(1000);
      signal?.throwIfAborted();
    }

    let content: ChapterContent = { title: "", content: "" };
    let attempts = 0;
    let success = false;
    let lastError: any = null;

    while (attempts < 3 && !success) {
      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "chapter", url: chapter.url }),
          signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        
        content = sanitizeChapterContent({
          title: data.title || chapter.title,
          content: data.content?.join("\n\n") || "",
          order: chapter.order,
        });

        if (content.content.length < 30) {
          throw new Error(`Nội dung quá ngắn (${content.content.length} ký tự)`);
        }

        success = true;
      } catch (err: any) {
        if (err.name === "AbortError") throw err;
        lastError = err;
        attempts++;
        if (attempts >= 3) break;
        await delay(2000 * attempts);
      }
    }

    if (!success && lastError) {
      // Don't throw — log warning and continue to next chapter
      content = sanitizeChapterContent({
        title: chapter.title,
        content: `[Lỗi tải chương: ${lastError.message}]`,
        order: chapter.order,
        warning: lastError.message,
      });
      consecutiveErrors++;

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`Quá nhiều lỗi liên tiếp (${MAX_CONSECUTIVE_ERRORS}). Dừng tải.`);
      }
    } else {
      consecutiveErrors = 0;
    }

    // Duplicate detection
    const currentHash = hashContent(content.content);
    if (contentHashes.has(currentHash) && content.content.length > 100) {
      content.warning = `⚠️ Nội dung trùng lặp với chương trước.`;
    }
    contentHashes.add(currentHash);

    const debugEntry: ScrapeDebugEntry = {
      chapterTitle: content.title,
      url: chapter.url,
      htmlLength: content.content.length,
      parsed: content,
      timedOut: false,
      contentTextLength: content.content.length,
    };

    onDebug?.(debugEntry);
    results.push(content);

    // ── Dynamic Next Chapter Crawling ──
    if (i === chapters.length - 1 && content.nextChapterUrl) {
      const alreadyExists = chapters.some((ch) => ch.url === content.nextChapterUrl);
      if (!alreadyExists && content.nextChapterUrl.startsWith("http")) {
        const newChapter: ChapterLink = {
          title: `Chương ${chapters.length + 1} (Đang lấy tiêu đề...)`,
          url: content.nextChapterUrl,
          order: chapters.length,
        };
        chapters.push(newChapter);
        onDynamicChapterAdded?.(newChapter);
      }
    }
  }

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
