import type { ChapterContent, ChapterLink, NovelInfo, SiteAdapter } from "../types";
import { extensionFetch } from "../extension-bridge";

/**
 * Adapter for TruyenFull.vision
 *
 * Key selectors discovered from raw HTML:
 * - Cover: `.book img` (Google Photos URL) + fallback `og:image` meta
 * - Chapters: `ul.list-chapter li a`
 * - Pagination: hidden input `#total-page` with total number of pages
 * - Novel slug: hidden input `#truyen-ascii`
 * - Each page has ~50 chapters (2 columns × 25)
 */
export const TruyenFullVisionAdapter: SiteAdapter = {
    name: "TruyenFull.today",
    group: "vn",
    urlPattern: /truyenfull\.(vision|today)/,

    async getNovelInfo(html: string, url: string, onProgress?: (count: number) => void): Promise<NovelInfo> {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const origin = new URL(url).origin;

        // --- Title ---
        const title =
            doc.querySelector("h3.title")?.textContent?.trim() ||
            doc.querySelector(".title")?.textContent?.trim() ||
            "";

        // --- Author ---
        const author =
            doc.querySelector('a[itemprop="author"]')?.textContent?.trim() ||
            doc.querySelector(".info div:nth-child(1) a")?.textContent?.trim() ||
            "Unknown";

        // --- Cover Image ---
        let coverImage = "";
        // Method 1: .book img (primary)
        const imgEl = doc.querySelector(".book img");
        if (imgEl) {
            coverImage = imgEl.getAttribute("src") || imgEl.getAttribute("data-src") || "";
        }
        // Method 2: og:image meta tag (fallback, often higher quality)
        if (!coverImage) {
            const ogImage = doc.querySelector('meta[property="og:image"]');
            coverImage = ogImage?.getAttribute("content") || "";
        }
        // Resolve relative URLs
        if (coverImage && !coverImage.startsWith("http")) {
            coverImage = new URL(coverImage, origin).href;
        }

        // --- Description ---
        const descHtml =
            doc.querySelector(".desc-text")?.innerHTML ||
            doc.querySelector(".desc")?.innerHTML ||
            "";
        let description = descHtml
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "");
        const textarea = doc.createElement("textarea");
        textarea.innerHTML = description;
        description = textarea.value.trim();

        // --- Chapters ---
        const chapters: ChapterLink[] = [];
        const baseUrl = url.split("?")[0].replace(/\/$/, "");

        const extractChapters = (pageDoc: Document) => {
            const links = pageDoc.querySelectorAll("ul.list-chapter li a");
            links.forEach((a) => {
                const cTitle = a.getAttribute("title")?.trim() || a.textContent?.trim() || "Không tên";
                let cUrl = a.getAttribute("href") || "";
                // Resolve relative URLs
                if (cUrl && !cUrl.startsWith("http")) {
                    cUrl = origin + (cUrl.startsWith("/") ? cUrl : "/" + cUrl);
                }
                cUrl = cUrl.split("#")[0]; // strip hash
                if (cUrl && !chapters.some(ch => ch.url === cUrl)) {
                    chapters.push({ title: cTitle, url: cUrl, order: chapters.length });
                }
            });
        };

        // Extract from first page
        extractChapters(doc);
        if (onProgress) onProgress(chapters.length);

        // --- Pagination: Use the reliable hidden input #total-page ---
        let totalPages = 1;
        const totalPageInput = doc.querySelector("#total-page");
        if (totalPageInput) {
            const val = parseInt(totalPageInput.getAttribute("value") || "1", 10);
            if (val > 1) totalPages = val;
        }

        // Fallback: parse pagination links if hidden input not found
        if (totalPages <= 1) {
            const trangMatches = html.match(/trang-(\d+)/g);
            if (trangMatches) {
                for (const m of trangMatches) {
                    const num = parseInt(m.replace("trang-", ""), 10);
                    if (num > totalPages) totalPages = num;
                }
            }
        }

        console.log(`TruyenFullVision: totalPages=${totalPages}, page1 chapters=${chapters.length}`);

        // Fetch remaining pages
        for (let page = 2; page <= totalPages; page++) {
            try {
                const pageUrl = `${baseUrl}/trang-${page}/`;
                const { html: pageHtml } = await extensionFetch(pageUrl);
                const pageDoc = parser.parseFromString(pageHtml, "text/html");
                extractChapters(pageDoc);
                if (onProgress) onProgress(chapters.length);
                if (page % 5 === 0 || page === totalPages) {
                    console.log(`TruyenFullVision: Page ${page}/${totalPages} → ${chapters.length} chapters`);
                }
            } catch (err) {
                console.error(`TruyenFullVision: Fetch page ${page} failed:`, err);
            }
        }

        console.log(`TruyenFullVision: Total ${chapters.length} chapters collected`);

        return { title, author, coverImage, description, chapters };
    },

    getChapterContent(html: string): ChapterContent {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const contentEl = doc.querySelector(".chapter-c") || doc.querySelector("#chapter-c");
        if (!contentEl) return { title: "", content: "" };

        contentEl.querySelectorAll("script, style, .ads, .quangcao, div[id^='ads'], .text-center").forEach(el => el.remove());

        const contentHtml = contentEl.innerHTML;
        let text = contentHtml
            .replace(/<(br|hr)\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|section|article|li)>/gi, "\n\n")
            .replace(/<[^>]+>/g, "");

        const textarea = doc.createElement("textarea");
        textarea.innerHTML = text;
        text = textarea.value.trim();

        text = text.split("\n").map(l => l.trim()).filter(l => {
            if (!l) return false;
            if (l.includes("truyenfull")) return false;
            return true;
        }).join("\n\n");

        const title =
            doc.querySelector(".chapter-title")?.textContent?.trim() ||
            doc.querySelector("h2 a.chapter-title")?.textContent?.trim() ||
            doc.querySelector("h2")?.textContent?.trim() || "";

        return { title, content: text };
    },
};
