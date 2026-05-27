import { sanitizeText } from "../utils";
import { extensionFetch, extensionDownloadSTVChapter, extensionStopScrape } from "./extension-bridge";
import { cloakFetch } from "./cloak-client";
import type { ChapterContent, ChapterLink, SiteAdapter } from "./types";

/** Detect if HTML is a Cloudflare/anti-bot challenge page instead of real content */
function isAntiBot(html: string): boolean {
  return (
    html.includes("cf-browser-verification") ||
    html.includes("__cf_chl") ||
    (html.includes("cloudflare") && html.includes("challenge")) ||
    html.includes("cf-challenge-running") ||
    html.includes("datadome") ||
    (html.length < 5000 && html.includes("Just a moment"))
  );
}

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

function isEquivalentUrl(url1: string | undefined, url2: string | undefined): boolean {
  if (!url1 || !url2) return false;
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);
    
    const cleanPath = (p: string) => {
      try {
        return decodeURIComponent(p.replace(/\/$/, "")).toLowerCase();
      } catch {
        return p.replace(/\/$/, "").toLowerCase();
      }
    };
    const path1 = cleanPath(u1.pathname);
    const path2 = cleanPath(u2.pathname);
    
    // Check if it's a known mirror of wikidich or other sites
    const isWikiMirror = (host: string) => 
      /wiki(dich|cv|cvnet|dichvip|dich3|dich4|dich5|dich6)/i.test(host);
      
    let result = false;
    if (isWikiMirror(u1.hostname) && isWikiMirror(u2.hostname)) {
      const getWikiChapterId = (path: string) => {
        const parts = path.split("/");
        const lastSegment = parts[parts.length - 1] || "";
        const slugParts = lastSegment.split("-");
        const lastToken = slugParts[slugParts.length - 1] || "";
        if (lastToken.length >= 8) {
          return lastToken;
        }
        return lastSegment;
      };
      result = getWikiChapterId(path1) === getWikiChapterId(path2);
    } else {
      result = u1.hostname.replace("www.", "") === u2.hostname.replace("www.", "") && path1 === path2;
    }
    
    console.log("[isEquivalentUrl]", { url1, url2, result });
    return result;
  } catch {
    const res = url1.toLowerCase().replace(/\/$/, "") === url2.toLowerCase().replace(/\/$/, "");
    console.log("[isEquivalentUrl catch]", { url1, url2, res });
    return res;
  }
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

  const defaultMin = adapter.minDelayMs ?? 0;
  const userDelay = delayMs ?? 7000;
  const safeDelayMs = Math.max(defaultMin, userDelay, 100);

  for (let i = 0; i < chapters.length; i++) {
    signal?.throwIfAborted();

    // Wait BEFORE starting the next chapter to ensure tab switching is synced with delay
    // Only do this for standard fetch. STV/Fanqie extension handles its own delay now.
    const isTabBased = adapter.name === "STV" || adapter.name === "Fanqie Novel";
    if (i > 0 && !isTabBased) {
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
          const isFanqieRealUrl = adapter.name === "Fanqie Novel" && !chapter.url.startsWith('fanqie-dynamic');
          const res = await extensionDownloadSTVChapter(
            chapter.id,
            chapter.url,
            // For Fanqie real URLs: don't send allowNext (we navigate directly)
            isFanqieRealUrl ? false : (i < chapters.length - 1 && !signal?.aborted),
            false,
            safeDelayMs
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

        // For Fanqie: ALWAYS use chapter.title from the list (PUA-encoded page titles are garbage)
        if (adapter.name === "Fanqie Novel") {
          content.title = chapter.title;
        } else if (!content.title || content.title.trim() === "") {
          content.title = extTitle || chapter.title;
        }

        const isTabBased = adapter.name === "STV" || adapter.name === "Fanqie Novel";
        if ((timedOut || content.content.length < 30) && !isTabBased) {
          throw new Error(`Lỗi lấy nội dung: Timeout hoặc quá ngắn (${content.content.length} ký tự)`);
        }

        success = true;
      } catch (err: any) {
        lastError = err;
        attempts++;
        if (attempts >= 3 || adapter.name === "STV" || adapter.name === "Fanqie Novel") {
          break;
        }
        await delay(1500 * attempts);
      }
    }

    if (!success && lastError && adapter.name !== "STV" && adapter.name !== "Fanqie Novel") {
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

    // For STV/Fanqie, stop IMMEDIATELY if content is missing or too short
    if ((adapter.name === "STV" || adapter.name === "Fanqie Novel") && (timedOut || content.content.length < 30)) {
      await extensionStopScrape();
      const chNumMatch = chapter.title.match(/(\d+)/);
      const chNum = chNumMatch ? `số ${chNumMatch[0]}` : "";
      const siteName = adapter.name === "Fanqie Novel" ? "Fanqie" : "SangTacViet";
      throw new Error(
        `STV_RESUME_REQUIRED|${chapter.title}|Vui lòng mở Tab ${siteName}, vào đúng chương ${chNum} ("${chapter.title}") và đảm bảo nội dung đã hiển thị, sau đó quay lại đây bấm "Tiếp tục".`,
      );
    }

    // Auto-stop after consecutive errors (any adapter)
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      await extensionStopScrape();
      throw new Error(
        `Đã dừng: ${MAX_CONSECUTIVE_ERRORS} chương liên tiếp có vấn đề (trùng/lỗi/ngắn). Kiểm tra lại trang nguồn.`,
      );
    }

    // ── Dynamic Next Chapter Crawling & Gap Healing ──
    if (content.nextChapterUrl && content.nextChapterUrl.startsWith("http") && !signal?.aborted) {
      const isLast = i === chapters.length - 1;
      if (isLast) {
        if (adapter.name === "Fanqie Novel" && success && !timedOut && content.content.length > 200) {
          const nextIdx = chapters.length;
          const newChapter: ChapterLink = {
            title: `Chương ${nextIdx + 1}`,
            url: content.nextChapterUrl,
            order: nextIdx,
            id: `fanqie-dynamic-${nextIdx}`
          };
          chapters.push(newChapter);
          onDynamicChapterAdded?.(newChapter);
        } else {
          const alreadyExists = chapters.some((ch) => isEquivalentUrl(ch.url, content.nextChapterUrl));
          if (!alreadyExists) {
            const newChapter: ChapterLink = {
              title: `Chương ${chapters.length + 1} (Đang lấy tiêu đề...)`,
              url: content.nextChapterUrl,
              order: chapters.length,
            };
            chapters.push(newChapter);
            onDynamicChapterAdded?.(newChapter);
          }
        }
      } else {
        // Check for gap in the middle
        const nextInQueue = chapters[i + 1];
        if (nextInQueue && !isEquivalentUrl(nextInQueue.url, content.nextChapterUrl)) {
          const alreadyExists = chapters.some((ch) => isEquivalentUrl(ch.url, content.nextChapterUrl));
          if (!alreadyExists) {
            // It is a missing chapter! Insert it at index i + 1
            const newChapter: ChapterLink = {
              title: `${chapter.title} - Tiếp theo (Đang lấy tiêu đề...)`,
              url: content.nextChapterUrl,
              order: chapter.order + 0.5,
            };
            chapters.splice(i + 1, 0, newChapter);
            onDynamicChapterAdded?.(newChapter);
            
            // Recalculate orders of subsequent chapters to maintain correct order sequence
            for (let k = i + 1; k < chapters.length; k++) {
              chapters[k].order = k;
            }
          }
        }
      }
    }
  }

  await extensionStopScrape();
  // Close any persistent tab created during scraping
  try {
    const { getExtensionId } = await import("./extension-bridge");
    const extId = getExtensionId();
    if (extId && (window as any).chrome?.runtime) {
      (window as any).chrome.runtime.sendMessage(extId, { action: "closePersistentTab" });
    }
  } catch { }

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
      // ── CloakBrowser Fallback ──
      // If the normal server fetch failed (likely anti-bot), try CloakBrowser
      try {
        const cloakResult = await cloakFetch(chapter.url, {
          timeout: 30000,
          signal,
        });

        if (cloakResult.html && !isAntiBot(cloakResult.html) && cloakResult.html.length > 500) {
          // Parse the HTML using a simple extraction (same as /api/scrape would do)
          const cloakRes = await fetch("/api/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "chapter-parse", html: cloakResult.html, url: chapter.url }),
            signal,
          });

          if (cloakRes.ok) {
            const cloakData = await cloakRes.json();
            content = sanitizeChapterContent({
              title: cloakData.title || chapter.title,
              content: cloakData.content?.join("\n\n") || "",
              order: chapter.order,
            });

            if (content.content.length >= 30) {
              success = true;
              content.warning = "🛡️ Tải qua CloakBrowser (anti-bot bypass)";
            }
          }
        }
      } catch (cloakErr: any) {
        // CloakBrowser also failed — fall through to error handling below
        console.warn("[CloakBrowser fallback] Failed:", cloakErr.message);
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
      const alreadyExists = chapters.some((ch) => isEquivalentUrl(ch.url, content.nextChapterUrl));
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
