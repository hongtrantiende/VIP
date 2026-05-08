import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

export const TimotxtAdapter: SiteAdapter = {
  name: "Timotxt",
  group: "cn",
  urlPattern: /timotxt\.com/,

  async getNovelInfo(html, url, onProgress) {
    let doc = new DOMParser().parseFromString(html, "text/html");

    // Extract cover image from the main page BEFORE navigating to /dir
    const coverImage = doc.querySelector(".book-img img, .cover img, meta[property='og:image']")?.getAttribute("content") 
                    || doc.querySelector(".book-img img, .cover img")?.getAttribute("src");
    const origTitle = doc.querySelector("h1, .book-title, .title, meta[property='og:title']")?.textContent?.trim() || "Unknown Title";
    const author = doc.querySelector(".author, .book-author, meta[property='og:novel:author']")?.textContent?.trim() || "Unknown Author";
    const description = doc.querySelector(".intro, .description, meta[property='og:description']")?.textContent?.trim() || "";

    // Fetch the full chapter directory if we're not already on it
    if (!url.includes("/dir")) {
      const dirUrl = new URL("dir", url + (url.endsWith("/") ? "" : "/")).toString();
      try {
        const { extensionFetch } = await import("../extension-bridge");
        const dirRes = await extensionFetch(dirUrl);
        if (!dirRes.timedOut && dirRes.html) {
          doc = new DOMParser().parseFromString(dirRes.html, "text/html");
          url = dirUrl;
        }
      } catch (e) {
        console.warn("Failed to fetch timotxt dir", e);
      }
    }

    const chapters: { title: string; url: string; order: number }[] = [];
    const seenUrls = new Set<string>();

    // Find the UL with the most chapter-like links (contains 第 or 章 in text)
    let bestUl: Element | null = null;
    let bestCount = 0;
    doc.querySelectorAll("ul").forEach(ul => {
      const chLinks = Array.from(ul.querySelectorAll("a[href]")).filter(a => {
        const t = a.textContent?.trim() || "";
        return (t.includes("第") || t.includes("章")) && t.length > 2;
      });
      if (chLinks.length > bestCount) {
        bestCount = chLinks.length;
        bestUl = ul;
      }
    });

    const container = bestUl || doc;
    const links = Array.from(container.querySelectorAll("a[href]"));

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      const titleText = link.textContent?.trim() || "";
      if (titleText.length < 2) return;
      if (titleText.includes("首页") || titleText.includes("上一页") || titleText.includes("下一页") || titleText.includes("排行")) return;

      // Only accept links with numeric .html patterns (e.g., /123.html)
      if (!href.match(/\/\d+\.html$/)) return;

      const fullUrl = new URL(href, url).toString();
      const cleanUrl = fullUrl.split("#")[0].split("?")[0];

      if (!seenUrls.has(cleanUrl)) {
        chapters.push({
          title: titleText,
          url: cleanUrl,
          order: chapters.length,
        });
        seenUrls.add(cleanUrl);
      }
    });

    return {
      title: origTitle,
      author,
      description,
      coverImage: coverImage ? new URL(coverImage, url).toString() : undefined,
      chapters,
    };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterTitle = doc.querySelector("h1, h2, h3, .title")?.textContent?.trim() || "";

    if (contentText) {
        return { title: chapterTitle, content: contentText };
    }

    const contentNode = doc.querySelector(".content, #content, #chaptercontent, .read-content");
    
    let rawText = "";
    if (contentNode) {
      const junkSelectors = ["script", "style", "iframe", ".ad", ".nav", ".footer"];
      junkSelectors.forEach(sel => {
        contentNode.querySelectorAll(sel).forEach(el => el.remove());
      });

      const clone = contentNode.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      clone.querySelectorAll("p").forEach((p) => p.replaceWith("\n" + p.textContent + "\n"));
      
      rawText = clone.textContent?.trim() || "";
    }

    if (!rawText && contentText) {
      rawText = contentText;
    }

    rawText = cleanGarbageLines(rawText);

    // Attempt to find Next Chapter URL for dynamic crawling
    let nextChapterUrl = "";
    const nextLinks = Array.from(doc.querySelectorAll("a[href]"));
    for (const link of nextLinks) {
      const text = link.textContent?.toLowerCase() || "";
      if (text.includes("下一章") || text.includes("下一頁") || text.includes("next")) {
         const href = link.getAttribute("href");
         if (href && !href.startsWith("javascript")) {
             nextChapterUrl = new URL(href, _url).toString();
             break;
         }
      }
    }

    return {
      title: chapterTitle,
      content: rawText,
      nextChapterUrl
    };
  },
};
