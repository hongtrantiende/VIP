import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

export const WikiDichAdapter: SiteAdapter = {
  name: "WikiDich",
  group: "vn",
  urlPattern: /wikicv\.net/i,
  chapterWaitSelector: "#bookContentBody",
  minDelayMs: 5000,

  async getNovelInfo(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const base = new URL(url);

    // ── Title ──
    const title = doc.querySelector("h1")?.textContent?.trim() ||
      doc.title?.split("-")[0]?.trim() || "Unknown";

    // ── Author ──
    // Look for "Tác giả:" label followed by a link
    let author = "";
    const authorLink = doc.querySelector('a[href*="/tac-gia/"]');
    if (authorLink) {
      author = authorLink.textContent?.trim() || "";
    }

    // ── Description ──
    const descEl = doc.querySelector(".manga-info, .story-description, .desc");
    const description = descEl?.textContent?.trim() || "";

    // ── Cover Image ──
    // <img class="z-depth-1 materialboxed initialized" src="/photo/...">
    let coverImage: string | undefined;
    const coverImg = doc.querySelector("img.materialboxed, img.z-depth-1");
    if (coverImg) {
      const src = coverImg.getAttribute("src");
      if (src) {
        coverImage = new URL(src, base).toString();
      }
    }

    // ── Chapters ──
    const chapters: any[] = [];
    const extractChapters = (document: Document) => {
      const chapterLinks = Array.from(document.querySelectorAll("li.chapter-name a.truncate, li.chapter-name a"));
      chapterLinks.forEach((el) => {
        const title = el.textContent?.trim() || `Chương ${chapters.length + 1}`;
        const href = el.getAttribute("href");
        if (href) {
          const absUrl = new URL(href, base).toString();
          if (absUrl !== url && !chapters.some(c => c.url === absUrl)) {
            chapters.push({
              id: href,
              title,
              url: absUrl,
              order: chapters.length,
            });
          }
        }
      });
    };

    extractChapters(doc);

    // ── Pagination (AJAX) ──
    const bookIdMatch = html.match(/var\s+bookId\s*=\s*"([^"]+)"/);
    const signKeyMatch = html.match(/var\s+signKey\s*=\s*"([^"]+)"/);

    if (bookIdMatch && signKeyMatch) {
      const bookId = bookIdMatch[1];
      const signKey = signKeyMatch[1];
      console.log(`[WikiDich] Found AJAX Pagination config: bookId=${bookId}, signKey=${signKey.substring(0, 10)}...`);

      try {
        const { extensionFetch } = await import("../extension-bridge");

        let offset = 56;
        const offsetMatch = html.match(/\.substring\((\d+)\)\s*\+\s*[a-zA-Z0-9_$]+\.substring\(0,\s*\1\)/);
        if (offsetMatch) {
          offset = parseInt(offsetMatch[1], 10);
        }
        const fuzzySign = (text: string) => text.substring(offset) + text.substring(0, offset);

        // SHA-256 hashing using Web Crypto API
        const sha256 = async (message: string) => {
          const msgBuffer = new TextEncoder().encode(message);
          const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        };

        let currentStart = chapters.length;
        const pageSize = 501;
        let hasMore = true;

        while (hasMore) {
          let success = false;
          let retries = 3;
          while (retries > 0 && !success) {
            try {
              const rawSign = fuzzySign(signKey + currentStart + pageSize);
              const sign = await sha256(rawSign);
              const ajaxUrl = new URL(`/book/index?bookId=${bookId}&start=${currentStart}&size=${pageSize}&signKey=${signKey}&sign=${sign}`, base).toString();

              console.log(`[WikiDich] Fetching chapters ${currentStart} to ${currentStart + pageSize}... (Retries left: ${retries})`);
              const res = await extensionFetch(ajaxUrl, { timeout: 15000 });

              if (res.html && res.html.trim().length > 0) {
                const pDoc = new DOMParser().parseFromString(res.html, "text/html");
                const oldLength = chapters.length;
                extractChapters(pDoc);

                if (chapters.length - oldLength === 0) {
                  hasMore = false; // No new chapters found
                } else {
                  currentStart += pageSize;
                }
                success = true;
              } else {
                hasMore = false;
                success = true;
              }
            } catch (e) {
              console.warn(`[WikiDich] Failed to fetch AJAX page ${currentStart}:`, e);
              retries--;
              if (retries === 0) {
                hasMore = false;
              } else {
                await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
              }
            }
          }
        }
      } catch (e) {
        console.warn("[WikiDich] Could not import extensionFetch for AJAX pagination", e);
      }
    }

    return { title, author, description, chapters, coverImage };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // ── Title ──
    const chapterTitle = doc.querySelector("h2, h1, .chapter-title")?.textContent?.trim() || "";

    // ── Content ──
    // Use contentText from extension if available (cleaner)
    if (contentText && contentText.length > 100) {
      let text = contentText;
      text = cleanWikiDichContent(text);
      return { title: chapterTitle, content: text };
    }

    // Fallback: parse HTML from #bookContentBody
    const contentEl = doc.querySelector("#bookContentBody, .content-body-wrapper, .chapter-content");
    if (!contentEl) return { title: chapterTitle, content: "" };

    // Remove ads, scripts, iframes
    const junkSelectors = [
      "script", "noscript", "style", "iframe",
      ".adsbygoogle", "[data-ad]", ".tpm-unit", ".tpads",
      ".gliaplayer-container", ".InstreamDom_root",
      "ins", "[data-slot]", "#tpmInpageContainer",
      "[id^='tpads']", "[id^='div-ad']",
      "[data-adbro-processed]", ".lemont-banner-host",
      "[data-innity-zone-loaded]",
    ];
    junkSelectors.forEach(sel => {
      contentEl.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Extract text from <p> tags
    const paragraphs = Array.from(contentEl.querySelectorAll("p"));
    let text = "";
    if (paragraphs.length > 5) {
      text = paragraphs
        .map(p => p.textContent?.trim() || "")
        .filter(t => t.length > 0)
        .join("\n\n");
    } else {
      // Fallback: innerHTML → text (handle divs properly)
      let htmlContent = contentEl.innerHTML;
      text = htmlContent
        .replace(/<(br|hr)[^>]*>/gi, "\n")
        .replace(/<\/(p|div|section|article|li)>/gi, "\n\n")
        .replace(/<[^>]+>/g, "");

      const tempDiv = doc.createElement("textarea");
      tempDiv.innerHTML = text;
      text = tempDiv.value.trim();
    }

    text = cleanWikiDichContent(text);

    // ── Next Chapter URL ──
    let nextChapterUrl = "";
    try {
      // WikiDich uses "Chương sau" or "Chương tiếp" links
      const allLinks = Array.from(doc.querySelectorAll("a[href]"));
      for (const link of allLinks) {
        const t = link.textContent?.trim()?.toLowerCase() || "";
        if (t.includes("chương sau") || t.includes("chương tiếp") ||
          t.includes("tiếp theo") || t === "next" ||
          t.includes("navigate_next") || t.includes("chevron_right")) {
          const href = link.getAttribute("href");
          if (href && !href.startsWith("javascript") && !href.startsWith("#")) {
            nextChapterUrl = new URL(href, _url).toString();
            break;
          }
        }
      }
    } catch { }

    return { title: chapterTitle, content: text, nextChapterUrl };
  },
};

/**
 * Clean WikiDich content: remove ads, watermarks, and garbage lines
 */
function cleanWikiDichContent(text: string): string {
  // Remove common WikiDich watermark patterns
  const watermarks = [
    /☀Truyện được đăng bởi.*?☀/g,
    /Truyện được đăng bởi.*$/gm,
    /★.*?đăng.*?★/g,
    /\(adsbygoogle\s*=.*?\)\.push\(\{.*?\}\);?/g,
    /var\s+_avlVar.*?;/g,
    /window\.unibotshb.*?;/g,
    /innity_adZoneAsync.*?;/g,
  ];

  for (const pattern of watermarks) {
    text = text.replace(pattern, "");
  }

  // Clean up formatting
  const lines = text.split("\n");
  const cleanedLines = lines
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(line => line.length > 0)
    // Filter out ad-related lines
    .filter(line => {
      const lower = line.toLowerCase();
      return !lower.includes("adsbygoogle") &&
        !lower.includes("_avlvar") &&
        !lower.includes("unibotshb") &&
        !lower.includes("innity_adzone") &&
        !lower.includes("lemont-banner") &&
        !lower.includes("powered by gliastudios") &&
        !lower.includes("advertisements") &&
        line.length > 2;
    });

  text = cleanedLines.join("\n\n");
  text = text.replace(/ +/g, " ");
  text = cleanGarbageLines(text);

  return text;
}
