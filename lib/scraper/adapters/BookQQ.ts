import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

export const BookQQAdapter: SiteAdapter = {
  name: "Book QQ",
  group: "cn",
  urlPattern: /book\.qq\.com/i,
  chapterWaitSelector: ".read-content, #content, .chapter-content",
  minDelayMs: 11000,
  useSequentialTab: true,

  async getNovelInfo(html, url, onProgress) {
    let doc = new DOMParser().parseFromString(html, "text/html");
    let currentBase = new URL(url);

    const title = doc.querySelector("h1, .book-title, .info-title")?.textContent?.trim() || doc.title.split("-")[0].trim();
    const author = doc.querySelector(".author, .book-author")?.textContent?.trim() || "";
    const description = doc.querySelector(".intro, .book-intro")?.textContent?.trim() || "";
    
    const coverImg = doc.querySelector(".book-cover img, .cover img");
    const coverImage = coverImg ? new URL(coverImg.getAttribute("src") || "", currentBase).href : undefined;

    const chapters: any[] = [];
    const chapterLinks = doc.querySelectorAll(".chapter-list a, .volume-list a, .dir-list a");
    
    Array.from(chapterLinks).forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      if (href.includes("javascript")) return;

      const absUrl = new URL(href, currentBase).href.split("#")[0];
      const titleText = a.textContent?.trim() || "";
      if (titleText.length < 2) return;

      chapters.push({
        title: titleText,
        url: absUrl,
        order: chapters.length,
      });
    });

    return { title, author, description, chapters, coverImage };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterTitle = doc.querySelector("h1, .chapter-title, .title")?.textContent?.trim() || "";

    let text = "";
    const contentEl = doc.querySelector(".read-content, #content, .chapter-content");
    
    if (contentEl) {
      const clone = contentEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, iframe, .ad, .bottom-nav").forEach((el) => el.remove());
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      clone.querySelectorAll("p").forEach((p) => p.insertAdjacentText("afterend", "\n"));
      text = clone.textContent || "";
    } else {
      text = contentText || "";
    }

    const lines = text.split('\n');
    const cleanedLines = lines.map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 0);
    text = cleanedLines.join('\n\n');

    text = cleanGarbageLines(text);

    // Attempt to find Next Chapter URL
    let nextChapterUrl = "";
    const nextLinks = Array.from(doc.querySelectorAll("a[href]"));
    for (const link of nextLinks) {
      const t = link.textContent?.trim() || "";
      if (t.includes("下一章") || t.includes("下一页") || t.includes("next")) {
         const href = link.getAttribute("href");
         if (href && !href.startsWith("javascript")) {
             nextChapterUrl = new URL(href, _url).toString();
             break;
         }
      }
    }

    return { title: chapterTitle, content: text, nextChapterUrl };
  },
};
