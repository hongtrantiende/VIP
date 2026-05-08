import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter, ChapterLink } from "../types";
import { extensionFetch } from "../extension-bridge";

/**
 * Adapter for XTruyen.vn
 */
export const XTruyenAdapter: SiteAdapter = {
  name: "XTruyen",
  group: "vn",
  urlPattern: /xtruyen\.vn/,
  // The site might hide chapters in collapsible blocks, 
  // but usually they are present in the DOM or loaded via JS.
  chapterWaitSelector: "#chapter-reading-content",

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const title = doc.querySelector(".post-title h1")?.textContent?.trim() || "";
    const author = doc.querySelector(".author-content a")?.textContent?.trim() || "Đang cập nhật";
    const coverImage = doc.querySelector(".summary_image img")?.getAttribute("src") || "";
    const description = doc.querySelector(".description-summary .summary__content")?.textContent?.trim() || "";

    // Support Next Chapter crawling natively: if user inputs a chapter URL
    if (url.includes("/chuong-") || url.includes("/chapter-")) {
      const chapterTitle = doc.querySelector(".breadcrumb li.active")?.textContent?.trim() || "Chương Đầu";
      const novelTitle = doc.querySelector(".breadcrumb li:nth-last-child(2) a")?.textContent?.trim() || title || "Truyện Crawl";
      
      return {
        title: novelTitle,
        author: "Đang cập nhật",
        description: "",
        coverImage: "",
        chapters: [{
          title: chapterTitle,
          url: url,
          order: 0
        }]
      };
    }

    // 1. Find Manga ID - Robust extraction
    let mangaId = "";
    
    // Method A: Body class (post-1234)
    const bodyClass = doc.body.className;
    const postMatch = bodyClass.match(/post-(\d+)/);
    if (postMatch) mangaId = postMatch[1];

    // Method B: Article ID (post-1234)
    if (!mangaId) {
      const article = doc.querySelector('article[id^="post-"]');
      if (article) mangaId = article.id.replace("post-", "");
    }

    // Method C: Script tags (var manga_id = '1234';)
    if (!mangaId) {
      const scripts = Array.from(doc.querySelectorAll('script'));
      for (const s of scripts) {
        const content = s.textContent || "";
        const m = content.match(/manga_id\s*=\s*['"](\d+)['"]/);
        if (m) {
          mangaId = m[1];
          break;
        }
      }
    }

    // Method D: Hidden inputs or data attributes
    if (!mangaId) {
      const idElem = doc.querySelector('[data-id], #manga-chapters-holder, .rating-post-id');
      mangaId = idElem?.getAttribute("data-id") || idElem?.getAttribute("value") || "";
    }

    if (!mangaId) {
       // Method E: Find any "post-XXX" ID in the document
       const postElem = doc.querySelector('[id*="post-"]');
       const m = postElem?.id.match(/post-(\d+)/);
       if (m) mangaId = m[1];
    }

    // 2. Fetch all chapters using the "Step-by-Step" Reveal mode in Extension
    const allChapterLinks: ChapterLink[] = [];
    
    try {
      // We always use extensionFetch for XTruyen because of its complex hidden DOM
      const response = await extensionFetch(url, {
        smartScrape: "XTRUYEN",
        timeout: 60000 // Give it a full minute to reveal and load everything
      });

      if (response.html) {
        const fullDoc = new DOMParser().parseFromString(response.html, "text/html");
        
        // Extract basic info again from the fresh HTML
        const title = fullDoc.querySelector(".post-title h1")?.textContent?.trim() || "";
        const author = fullDoc.querySelector(".author-content a")?.textContent?.trim() || "Đang cập nhật";
        const coverImage = fullDoc.querySelector(".summary_image img")?.getAttribute("src") || "";
        const description = fullDoc.querySelector(".description-summary .summary__content")?.textContent?.trim() || "";

        // Extract all revealed chapters
        const chapterItems = Array.from(fullDoc.querySelectorAll('ul.sub-chap-list li.wp-manga-chapter a'));
        
        chapterItems.forEach(a => {
          allChapterLinks.push({
            title: a.textContent?.trim() || "Chương không rõ",
            url: (a as HTMLAnchorElement).href,
            order: 0
          });
        });
        onProgress?.(allChapterLinks.length);

        // Deduplicate and sort
        const seenUrls = new Set<string>();
        const uniqueChapters: ChapterLink[] = [];
        allChapterLinks.forEach(ch => {
          if (!seenUrls.has(ch.url)) {
            seenUrls.add(ch.url);
            uniqueChapters.push(ch);
          }
        });

        const chapters = uniqueChapters.map(ch => {
          const match = ch.url.match(/chuong-([\d]+)/) || ch.url.match(/chapter-([\d]+)/);
          const num = match ? parseInt(match[1], 10) : 0;
          return { ...ch, num };
        }).sort((a, b) => a.num - b.num)
          .map((ch, i) => ({
            title: ch.title,
            url: ch.url,
            order: i
          }));

        return { title, author, description, coverImage, chapters };
      }
    } catch (e) {
      console.error("XTruyen reveal failed", e);
    }

    // Fallback to basic info if reveal fails
    return { title, author, description, coverImage, chapters: [] };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const container = doc.querySelector("#chapter-reading-content");
    
    if (!container && !contentText) return { title: "", content: "" };

    // If we have contentText (from extension bridge innerText), it's cleaner
    let rawText = contentText || "";

    if (!rawText && container) {
      // Remove ads and unwanted elements
      container.querySelectorAll(".aam-ad-container, .carousel, script, style").forEach(el => el.remove());
      rawText = (container as HTMLElement).innerText;
    }

    const title = doc.querySelector(".breadcrumb li.active")?.textContent?.trim() || "";
    
    // Find Next Chapter Link
    const nextChapterUrl = (doc.querySelector("a.next_page") as HTMLAnchorElement)?.href || "";

    // Clean up
    let text = rawText
      .split("\n")
      .map(line => line.trim())
      .filter(line => {
        if (!line) return false;
        // Filter out common ad lines or UI text
        if (line.includes("MonkeyD.net.vn")) return false;
        if (line.includes("________________________________________")) return false;
        return true;
      })
      .join("\n\n");

    text = cleanGarbageLines(text);

    return { title, content: text, nextChapterUrl };
  },
};
