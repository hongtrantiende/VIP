/**
 * Catalog Scanner — scans a site's browse/listing pages to discover all novels.
 * Uses server-side fetch (no extension needed) to avoid tab conflicts.
 */

import type { CatalogNovel } from "./types";

export interface CatalogScanAdapter {
    /** Base URL pattern for the catalog/browse pages */
    getCatalogUrl(baseUrl: string, page: number): string;
    /** Parse a catalog page HTML and extract novel entries */
    parseCatalogPage(html: string, baseUrl: string): CatalogNovel[];
    /** Detect if there's a next page. Returns false when no more pages. */
    hasNextPage(html: string, currentPage: number): boolean;
}

// ─── Adapter implementations ─────────────────────────────────

export const CATALOG_ADAPTERS: Record<string, CatalogScanAdapter> = {
    "truyenfull.today": {
        getCatalogUrl(baseUrl, page) {
            const origin = new URL(baseUrl).origin;
            return `${origin}/danh-sach/truyen-moi/trang-${page}/`;
        },

        parseCatalogPage(html, baseUrl) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const origin = new URL(baseUrl).origin;
            const novels: CatalogNovel[] = [];

            // TruyenFull lists novels in .row .truyen-title a
            const items = doc.querySelectorAll(".list-truyen .row");
            items.forEach((row) => {
                const titleEl = row.querySelector(".truyen-title a");
                if (!titleEl) return;

                const title = titleEl.textContent?.trim() || "";
                let url = titleEl.getAttribute("href") || "";
                if (url && !url.startsWith("http")) {
                    url = origin + (url.startsWith("/") ? url : "/" + url);
                }
                if (!title || !url) return;

                const author = row.querySelector(".author")?.textContent?.trim() || "";
                const genre = row.querySelector(".text-info a")?.textContent?.trim() || "";

                // Try to get cover from lazyload or img
                const img = row.querySelector("img");
                const coverImage = img?.getAttribute("src") || img?.getAttribute("data-src") || "";

                novels.push({ title, url, author, genre, coverImage });
            });

            return novels;
        },

        hasNextPage(html, currentPage) {
            // Check if pagination has a next page link
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Look for pagination: .pagination li with page number > current
            const lastPageLink = doc.querySelector(".pagination .last a, .pagination li:last-child a");
            if (lastPageLink) {
                const href = lastPageLink.getAttribute("href") || "";
                const match = href.match(/trang-(\d+)/);
                if (match) {
                    return parseInt(match[1], 10) > currentPage;
                }
            }

            // Fallback: check if there are any results on this page
            const items = doc.querySelectorAll(".list-truyen .row .truyen-title a");
            return items.length > 0;
        },
    },
};

/** Detect which catalog adapter to use based on URL */
export function detectCatalogAdapter(url: string): CatalogScanAdapter | null {
    try {
        const hostname = new URL(url).hostname;
        for (const [pattern, adapter] of Object.entries(CATALOG_ADAPTERS)) {
            if (hostname.includes(pattern)) return adapter;
        }
    } catch { }
    return null;
}

/**
 * Scan a website's catalog pages to discover novels.
 * Stops when: no more pages, maxNovels reached, or signal aborted.
 */
export async function scanSiteCatalog(
    siteUrl: string,
    adapter: CatalogScanAdapter,
    options?: {
        maxNovels?: number;
        maxPages?: number;
        startPage?: number;
        existingUrls?: Set<string>;
        onProgress?: (page: number, novelCount: number) => void;
        signal?: AbortSignal;
    },
): Promise<CatalogNovel[]> {
    const maxNovels = options?.maxNovels ?? 999999;
    const maxPages = options?.maxPages ?? 500;
    const startPage = options?.startPage ?? 1;
    const allNovels: CatalogNovel[] = [];
    const seenUrls = new Set<string>(options?.existingUrls ?? []);

    for (let page = startPage; page <= startPage + maxPages - 1; page++) {
        if (options?.signal?.aborted) break;

        const catalogUrl = adapter.getCatalogUrl(siteUrl, page);

        try {
            // Use server-side fetch to avoid extension tab conflicts
            const res = await fetch("/api/scrape", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "fetch", url: catalogUrl }),
                signal: options?.signal,
            });
            let html = "";
            if (res.ok) {
                const data = await res.json();
                html = data.html || "";
            } else {
                // Fallback: direct fetch (may fail with CORS on some sites)
                const directRes = await fetch(catalogUrl, { signal: options?.signal });
                html = await directRes.text();
            }
            const novels = adapter.parseCatalogPage(html, siteUrl);

            for (const novel of novels) {
                if (seenUrls.has(novel.url)) continue;
                seenUrls.add(novel.url);
                allNovels.push(novel);
                if (allNovels.length >= maxNovels) break;
            }

            options?.onProgress?.(page, allNovels.length);

            if (allNovels.length >= maxNovels) break;
            if (!adapter.hasNextPage(html, page)) break;

            // Small delay between pages to avoid rate limiting
            await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
            console.error(`[CatalogScanner] Page ${page} failed:`, err);
            // Continue to next page on error
        }
    }

    return allNovels;
}
