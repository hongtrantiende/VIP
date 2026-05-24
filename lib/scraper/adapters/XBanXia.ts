import type { SiteAdapter } from "../types";

/**
 * Adapter for 半夏小說 (xbanxia.cc)
 *
 * URL patterns:
 *   Novel page  : https://www.xbanxia.cc/books/{bookId}.html
 *   Chapter page: https://www.xbanxia.cc/books/{bookId}/{chapterId}.html
 *
 * The chapter list is fully embedded in the novel page (no pagination needed).
 * Cover images are lazy-loaded via `data-original` attribute.
 * Chapter content lives inside `#nr1`.
 */
export const XBanXiaAdapter: SiteAdapter = {
  name: "半夏小說 (XBanXia)",
  group: "cn",
  urlPattern: /xbanxia\.cc/i,

  // The novel page has the full chapter list statically rendered — just wait for them
  novelWaitSelector: ".book-list ul li a, .book-describe h1",
  // Chapter content is in #nr1 and always present
  chapterWaitSelector: "#nr1",

  async getNovelInfo(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const base = new URL(url);

    // ── Title ──────────────────────────────────────────────────────────────
    // The <h1> reads "半夏小說{title}" so we strip the site name prefix
    const rawTitle =
      doc.querySelector(".book-describe h1")?.textContent?.trim() ||
      doc.querySelector("h1")?.textContent?.trim() ||
      "";
    const title = rawTitle.replace(/^半夏小說/, "").trim();

    // ── Author ─────────────────────────────────────────────────────────────
    const authorEl = doc.querySelector(".book-describe p a[href*='/author/']");
    const rawAuthor = authorEl?.textContent?.trim() || "";
    // Strip "簽約" prefix that the site adds, e.g. "簽約李寂v5" → "李寂v5"
    const author = rawAuthor.replace(/^簽約/, "").trim();

    // ── Cover image ────────────────────────────────────────────────────────
    // Cover is lazy-loaded: <img class="lazy" data-original="https://...">
    const coverEl = doc.querySelector(".book-img img.lazy, .book-img img");
    const coverSrc =
      coverEl?.getAttribute("data-original") ||
      coverEl?.getAttribute("src") ||
      "";
    const coverImage = coverSrc && !coverSrc.includes("nocover")
      ? new URL(coverSrc, base).href
      : undefined;

    // ── Chapter list ───────────────────────────────────────────────────────
    // All chapters are rendered directly in .book-list ul li a (no pagination)
    const chapterLinks = doc.querySelectorAll(".book-list ul li a[href]");
    const chapters: { title: string; url: string; order: number }[] = [];
    const seenUrls = new Set<string>();

    chapterLinks.forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!href) return;
      const absUrl = new URL(href, base).href;
      if (seenUrls.has(absUrl)) return;
      seenUrls.add(absUrl);

      const chapterTitle =
        a.getAttribute("title")?.trim() ||
        a.textContent?.trim() ||
        `Chương ${chapters.length + 1}`;

      chapters.push({ title: chapterTitle, url: absUrl, order: chapters.length });
    });

    return { title, author, chapters, coverImage };
  },

  getChapterContent(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // ── Chapter title ───────────────────────────────────────────────────────
    const chapterTitle =
      doc.querySelector("#nr_title")?.textContent?.trim() ||
      doc.querySelector("h1")?.textContent?.trim() ||
      "";

    // ── Content extraction ─────────────────────────────────────────────────
    let text = "";
    const contentEl = doc.querySelector("#nr1");

    if (contentEl) {
      const clone = contentEl.cloneNode(true) as HTMLElement;

      // Remove any injected navigation / ad / script nodes inside #nr1
      clone
        .querySelectorAll("script, style, .outbt, .nr_set, nav, h1")
        .forEach((el) => el.remove());

      // Normalise line-breaks
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      clone
        .querySelectorAll("p")
        .forEach((p) => p.insertAdjacentText("afterend", "\n\n"));

      text = clone.textContent || "";
    }

    // ── Post-process ────────────────────────────────────────────────────────
    text = text
      .replace(/半夏小說，快樂很多/g, "")  // Remove site watermark
      .replace(/xbanxia\.cc/gi, "")
      .replace(/半夏小說/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Strip the chapter title if it appears as the first line
    if (chapterTitle && text.startsWith(chapterTitle)) {
      text = text.slice(chapterTitle.length).trimStart();
    }

    // ── Next chapter link ───────────────────────────────────────────────────
    const nextLink = doc.querySelector("a[rel='next'], .next a, li.next a");
    let nextChapterUrl: string | undefined;
    if (nextLink) {
      const href = nextLink.getAttribute("href") || "";
      if (href && !href.includes("javascript")) {
        nextChapterUrl = new URL(href, url).href;
      }
    }

    return { title: chapterTitle, content: text, nextChapterUrl };
  },
};
