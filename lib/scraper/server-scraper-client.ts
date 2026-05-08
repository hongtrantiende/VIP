/**
 * Client-side wrapper for the server-side scrape API.
 * Use this instead of extension-bridge when you want to:
 * - Fetch static HTML pages quickly
 * - Analyze page structure without an extension
 * - Generate scraping prompts
 */

import type {
  ServerNovelInfo,
  ServerChapterContent,
  AnalyzedSelectors,
} from "./server-scraper";

const API_URL = "/api/scrape";

async function callScrapeAPI<T>(action: string, url: string, extra?: Record<string, any>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, url, ...extra }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── Public API ───────────────────────────────────────────────

/** Quick test if server-side fetch works for this URL */
export async function serverTestFetch(url: string) {
  return callScrapeAPI<{
    success: boolean;
    htmlLength: number;
    hasContent: boolean;
    isCloudflareBlocked: boolean;
    error?: string;
    responseTime: number;
  }>("test", url);
}

/** Fetch raw HTML from server (bypasses CORS) */
export async function serverFetchHtml(url: string) {
  return callScrapeAPI<{ html: string; length: number }>("fetch", url);
}

/** Analyze a novel page → title, author, cover, chapters */
export async function serverAnalyzeNovel(url: string) {
  return callScrapeAPI<ServerNovelInfo>("analyze", url);
}

/** Analyze a chapter page → title, content paragraphs */
export async function serverAnalyzeChapter(url: string) {
  return callScrapeAPI<ServerChapterContent>("chapter", url);
}

/** Auto-detect CSS selectors for a novel site */
export async function serverAnalyzeSelectors(url: string) {
  return callScrapeAPI<AnalyzedSelectors>("selectors", url);
}

/** Generate a scraping prompt for AI */
export async function serverGeneratePrompt(url: string) {
  return callScrapeAPI<{ prompt: string }>("prompt", url);
}

/** Batch fetch multiple chapters */
export async function serverBatchChapters(urls: string[], delayMs = 500) {
  return callScrapeAPI<{
    results: (ServerChapterContent & { url: string; error: string | null })[];
    total: number;
  }>("batch-chapters", urls[0], { urls, delayMs });
}
