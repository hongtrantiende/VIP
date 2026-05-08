/**
 * API Route: Server-side HTML fetch & analysis
 * 
 * POST /api/scrape
 * Body: { action: "fetch" | "analyze" | "chapter" | "prompt" | "test", url: string }
 *
 * This bypasses CORS and fetches HTML directly from the server,
 * eliminating the need for a browser extension for simple HTML pages.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  analyzeNovelPage,
  analyzeChapterPage,
  analyzeSelectors,
  generateScrapingPrompt,
  fetchHtml,
  testServerFetch,
} from "@/lib/scraper/server-scraper";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (!url.startsWith("http")) {
      return NextResponse.json({ error: "Invalid URL — must start with http" }, { status: 400 });
    }

    switch (action) {
      case "test": {
        const result = await testServerFetch(url);
        return NextResponse.json(result);
      }

      case "fetch": {
        const html = await fetchHtml(url);
        return NextResponse.json({
          html,
          length: html.length,
        });
      }

      case "analyze": {
        const novelInfo = await analyzeNovelPage(url);
        return NextResponse.json(novelInfo);
      }

      case "chapter": {
        const chapterData = await analyzeChapterPage(url);
        return NextResponse.json(chapterData);
      }

      case "selectors": {
        const selectors = await analyzeSelectors(url);
        return NextResponse.json(selectors);
      }

      case "prompt": {
        const prompt = await generateScrapingPrompt(url);
        return NextResponse.json({ prompt });
      }

      case "batch-chapters": {
        // Batch fetch multiple chapter URLs
        const { urls, delayMs = 500 } = body;
        if (!Array.isArray(urls)) {
          return NextResponse.json({ error: "urls array required" }, { status: 400 });
        }

        const results: any[] = [];
        for (let i = 0; i < urls.length; i++) {
          try {
            const chapterData = await analyzeChapterPage(urls[i]);
            results.push({ url: urls[i], ...chapterData, error: null });
          } catch (err: any) {
            results.push({ url: urls[i], error: err.message });
          }
          // Delay between requests to avoid rate limiting
          if (i < urls.length - 1 && delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }

        return NextResponse.json({ results, total: results.length });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Valid: test, fetch, analyze, chapter, selectors, prompt, batch-chapters` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    console.error("[/api/scrape] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
