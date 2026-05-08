import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

export const CzbooksAdapter: SiteAdapter = {
  name: "Czbooks",
  group: "cn",
  urlPattern: /czbooks\.net/,
  chapterWaitSelector: ".content, #content, .chapter-detail",

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const title = doc.querySelector(".novel-detail .title, h1, .info-title")?.textContent?.trim() || "Unknown Title";
    const author = doc.querySelector(".author, .info-author, a[href*='/author/']")?.textContent?.trim() || "Unknown Author";
    const description = doc.querySelector(".description, .info-desc, meta[name='description']")?.textContent?.trim() || "";
    
    let coverImg = doc.querySelector(".cover img, .novel-detail img, .thumbnail img")?.getAttribute("src");
    if (coverImg && coverImg.startsWith("//")) coverImg = "https:" + coverImg;

    const chapters: { title: string; url: string; order: number }[] = [];
    const seenUrls = new Set<string>();

    const links = Array.from(doc.querySelectorAll(".chapter-list a, .nav.chapter-list a, .nav-list a, ul.list li a"));

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      const titleText = link.textContent?.trim() || "";
      if (titleText.length < 2) return;

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
      title,
      author,
      description,
      coverImage: coverImg ? new URL(coverImg, url).toString() : undefined,
      chapters,
    };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterTitle = doc.querySelector("h1, .chapter-title, .name")?.textContent?.trim() || "";

    if (contentText) {
        return { title: chapterTitle, content: contentText };
    }

    const contentNode = doc.querySelector(".content, #content, .chapter-detail, .read-content");
    
    let rawText = "";
    if (contentNode) {
      const junkSelectors = ["script", "style", "iframe", ".ad", ".nav", ".footer", ".watermark"];
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
