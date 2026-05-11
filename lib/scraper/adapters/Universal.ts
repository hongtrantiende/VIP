import type { SiteAdapter, NovelInfo, ChapterContent } from "../types";

/**
 * Universal Adapter - A smart fallback that tries to extract novel data
 * using common patterns, similar to the Python downloader logic.
 */
export interface CustomScraperConfig {
  titleSelector?: string;
  authorSelector?: string;
  coverSelector?: string;
  chapterListSelector?: string;
  chapterTitleSelector?: string;
  contentSelector?: string;
  waitSelector?: string;
}

export function createCustomAdapter(config: CustomScraperConfig): SiteAdapter {
  return {
    name: "Custom",
    urlPattern: /.*/,
    chapterWaitSelector: config.waitSelector,

    getNovelInfo(html, url) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      
      // 1. Extract Title
      let title = "Unknown Novel";
      if (config.titleSelector) {
        title = doc.querySelector(config.titleSelector)?.textContent?.trim() || title;
      } else {
        title = doc.querySelector("h1, h2, .title, #title")?.textContent?.trim() 
             || doc.querySelector("title")?.textContent?.split("-")[0]?.trim()
             || title;
      }

      // 2. Extract Author
      let author: string | undefined = undefined;
      if (config.authorSelector) {
        author = doc.querySelector(config.authorSelector)?.textContent?.trim();
      } else {
        const authorRegex = /(tác giả|author|tac gia):\s*([^|\n<]+)/i;
        const authorMatch = html.match(authorRegex);
        if (authorMatch) {
          author = authorMatch[2].trim();
        } else {
          author = doc.querySelector(".author, .tac-gia, a[href*='tac-gia']")?.textContent?.trim();
        }
      }

      // 3. Extract Cover
      let coverImage: string | undefined = undefined;
      if (config.coverSelector) {
        coverImage = doc.querySelector(config.coverSelector)?.getAttribute("src") || undefined;
      } else {
        coverImage = doc.querySelector("img[src*='cover'], img[src*='thumb'], img[class*='book']")?.getAttribute("src") || undefined;
      }

      // 4. Extract Chapters
      const chapters: NovelInfo['chapters'] = [];
      const seenUrls = new Set<string>();

      if (config.chapterListSelector) {
        const links = doc.querySelectorAll(config.chapterListSelector);
        links.forEach((link) => {
          const text = link.textContent?.trim() || "";
          const href = link.getAttribute("href");
          if (!href) return;
          const fullUrl = new URL(href, url).toString();
          if (!seenUrls.has(fullUrl)) {
            chapters.push({ title: text, url: fullUrl, order: chapters.length });
            seenUrls.add(fullUrl);
          }
        });
      } else {
        const links = doc.querySelectorAll("a[href]");
        links.forEach((link) => {
          const text = link.textContent?.trim() || "";
          const href = link.getAttribute("href");
          if (!href) return;
          const fullUrl = new URL(href, url).toString();
          if (/chương|chapter|quyển|tập|tiết|phần/i.test(text) && /\d+/.test(text)) {
            if (!seenUrls.has(fullUrl)) {
              chapters.push({ title: text, url: fullUrl, order: chapters.length });
              seenUrls.add(fullUrl);
            }
          }
        });
      }

      return {
        title,
        author,
        coverImage: coverImage ? new URL(coverImage, url).toString() : undefined,
        chapters,
      };
    },

    getChapterContent(html, _url, contentText) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      
      // 1. Extract Chapter Title
      let title = "";
      if (config.chapterTitleSelector) {
        title = doc.querySelector(config.chapterTitleSelector)?.textContent?.trim() || "";
      } else {
        title = doc.querySelector("h1, h2, .chapter-title, .chap-title")?.textContent?.trim() 
             || doc.querySelector("title")?.textContent?.split("-")[0]?.trim()
             || "";
      }

      // 2. Extract Content
      let content = "";
      if (config.contentSelector) {
        const container = doc.querySelector(config.contentSelector);
        if (container) {
          container.querySelectorAll("script, style, iframe, .ads, .advertisement").forEach(el => el.remove());
          content = (container as HTMLElement).innerText || "";
        }
      } else {
        let bestContainer: Element | null = null;
        let maxPCount = 0;
        const containers = doc.querySelectorAll("div, article, section");
        containers.forEach((container) => {
          const pCount = container.querySelectorAll("p").length;
          if (pCount > maxPCount) {
            maxPCount = pCount;
            bestContainer = container;
          }
        });

        if (!bestContainer || maxPCount < 3) {
          bestContainer = doc.querySelector("#content, .content, #chapter-content, .chap-content, #vung_doc, .reading-detail");
        }

        if (bestContainer) {
          bestContainer.querySelectorAll("script, style, iframe, .ads, .advertisement").forEach(el => el.remove());
          content = (bestContainer as HTMLElement).innerText || "";
        } else if (contentText) {
          content = contentText;
        }
      }

      // Basic cleaning
      content = content
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 5)
        .filter(line => !/quảng cáo|click|truyenfull|metruyenchu|ads/i.test(line))
        .join("\n\n");

      // Attempt to find Next Chapter URL for dynamic crawling
      let nextChapterUrl = "";
      const nextLinks = Array.from(doc.querySelectorAll("a[href]"));
      for (const link of nextLinks) {
        const text = link.textContent?.toLowerCase() || "";
        if (text.includes("chương sau") || text.includes("chương kế") || text === "tiếp" || text === "next" || text.includes("sau »") || text.includes("tiếp theo")) {
           const href = link.getAttribute("href");
           if (href && !href.startsWith("javascript")) {
               nextChapterUrl = new URL(href, _url).toString();
               break;
           }
        }
      }

      return { title, content, nextChapterUrl };
    },
  };
}

export const UniversalAdapter: SiteAdapter = createCustomAdapter({});
