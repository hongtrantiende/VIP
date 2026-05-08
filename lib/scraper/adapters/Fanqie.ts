import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

export const FanqieAdapter: SiteAdapter = {
  name: "Fanqie Novel",
  group: "cn",
  urlPattern: /fanqienovel\.com/i,
  chapterWaitSelector: ".muye-reader-content",
  minDelayMs: 11000,
  useSequentialTab: true,

  async getNovelInfo(html, url, onProgress) {
    let doc = new DOMParser().parseFromString(html, "text/html");
    let currentBase = new URL(url);

    const title = doc.querySelector("h1, .info-name")?.textContent?.trim() || doc.title.split("-")[0].trim();
    const author = doc.querySelector(".author-name, .info-author")?.textContent?.trim() || "";
    const description = doc.querySelector(".abstract, .info-desc")?.textContent?.trim() || "";
    
    const coverImg = doc.querySelector(".book-cover-img");
    const coverImage = coverImg ? new URL(coverImg.getAttribute("src") || "", currentBase).href : undefined;

    const chapters = [
      {
        title: "Bắt đầu từ chương hiện tại",
        url: currentUrl,
        order: 0,
      }
    ];

    return { title, author, description, chapters, coverImage };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterTitle = doc.querySelector("h1, .title, .reader-header-title")?.textContent?.trim() || "";

    let text = "";
    const contentEl = doc.querySelector(".muye-reader-content, .article-content, #content");
    
    if (contentEl) {
      const junkSelectors = ["script", "style", ".bottom-ad", "iframe", ".nav", ".footer"];
      junkSelectors.forEach(sel => {
        contentEl.querySelectorAll(sel).forEach(el => el.remove());
      });
      
      let htmlContent = contentEl.innerHTML;
      htmlContent = htmlContent.replace(/<br\s*\/?>/gi, '\n');
      htmlContent = htmlContent.replace(/<p[^>]*>/gi, '\n');
      htmlContent = htmlContent.replace(/<\/p>/gi, '\n');
      
      const tempDiv = doc.createElement("div");
      tempDiv.innerHTML = htmlContent;
      text = tempDiv.textContent?.trim() || "";
    } else {
      text = contentText || "";
    }

    // ── FANQIE DECRYPTION LOGIC ──
    // Mapping placeholders since python original snippet keys were lost in chat
    const mapping: Record<string, string> = {};

    for (const [oldChar, newChar] of Object.entries(mapping)) {
      if (oldChar) text = text.split(oldChar).join(newChar);
    }

    // Remove remaining PUA characters
    text = text.replace(/[\ue000-\uf8ff]/g, '');

    const lines = text.split('\n');
    const cleanedLines = lines.map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 0);
    text = cleanedLines.join('\n\n');

    text = text.replace(/唐治/g, '唐治').replace(/隆基哥/g, '隆基哥');
    text = text.replace(/ +/g, ' ');

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
