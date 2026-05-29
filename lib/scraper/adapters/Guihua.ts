import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

export const GuihuaAdapter: SiteAdapter = {
  name: "Guihua",
  group: "cn",
  urlPattern: /guihualianpian\.cn/,
  chapterWaitSelector: ".read-content, .content, #content",

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const title = doc.querySelector("title")?.textContent?.split("-")[0]?.trim() || "Unknown Title";
    const author = "Unknown"; // Guihua usually focuses on stories rather than authors
    const description = doc.querySelector(".description, meta[name='description']")?.getAttribute("content") || "";
    
    // Guihua covers might be rare, try to find an img if exists
    let coverImg = doc.querySelector("img.cover, .book-img img")?.getAttribute("src");
    if (!coverImg || coverImg.includes("default") || coverImg.startsWith("data:")) {
      const allImgs = Array.from(doc.querySelectorAll("img"));
      const coverEl = allImgs.find(img => img.getAttribute("data-src")?.includes("novel_cover"));
      if (coverEl) coverImg = coverEl.getAttribute("data-src");
    }

    const chapters: { title: string; url: string; order: number }[] = [];
    const seenUrls = new Set<string>();

    // First try .chapter-link which uniquely identifies chapter list items on guihualianpian
    let links = Array.from(doc.querySelectorAll(".chapter-link"));
    
    // Fallback if .chapter-link class is not present on some pages
    if (links.length === 0) {
      const container = doc.querySelector(".two-col-chapters, .chapters, .catalog, .volume-list");
      if (container) {
        links = Array.from(container.querySelectorAll("a[href]"));
      } else {
        links = Array.from(doc.querySelectorAll("a[href]"));
      }
    }

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      // Guihua chapters have "chapter.php", "view.php" or ID numbers
      if (!href.includes("chapter.php") && !href.includes("view.php") && !href.match(/\d/)) return;
      
      const titleText = link.textContent?.trim() || "";
      if (titleText.length < 2) return;
      
      // Skip navigation, home, user, breadcrumbs, category, and author links
      if (/首页|上一页|下一页|返回|专区|排行|书库|分类|作者|登录|注册|书架/i.test(titleText)) return;
      if (link.closest(".top-wrap, .breadcrumb, .nav, .footer, .author, .novel-latest, #novel-latest")) return;

      const fullUrl = new URL(href, url).toString();
      const cleanUrl = fullUrl.split("#")[0];

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
    
    // Extract Chapter Title
    let chapterTitle = "";
    
    // 1. Try dedicated .chapter-name element
    const chapterNameEl = doc.querySelector(".chapter-name, .chaptername");
    if (chapterNameEl) {
      chapterTitle = chapterNameEl.textContent?.trim() || "";
    }
    
    // 2. Fallback to <title> split
    if (!chapterTitle) {
      const titleTag = doc.querySelector("title")?.textContent || "";
      const parts = titleTag.split("-");
      if (parts.length > 0) {
        chapterTitle = parts[0].trim();
      }
    }
    
    // 3. Fallback to headers excluding comments or garbage
    if (!chapterTitle) {
      const headings = Array.from(doc.querySelectorAll("h1, h2, h3, .title, .title-chapter"));
      for (const el of headings) {
        const text = el.textContent?.trim() || "";
        if (text && !/评论|comment|熱門|题材|首页/i.test(text)) {
          chapterTitle = text;
          break;
        }
      }
    }

    // Always parse HTML to remove junk, fall back to contentText if empty

    // Attempt to find content
    let contentNode: Element | null = doc.querySelector(".content, #content, .article-content, #article, .text, .read-content");
    
    // Fallback for Guihua's specific layout (e.g., .main-container)
    if (!contentNode) {
        contentNode = doc.querySelector(".main-container");
    }

    if (!contentNode) {
        // Ultimate fallback: find longest div
        let maxLen = 0;
        let bestDiv: Element | null = null;
        doc.querySelectorAll("div").forEach(div => {
            const text = div.textContent?.trim() || "";
            if (text.length > maxLen) {
                maxLen = text.length;
                bestDiv = div;
            }
        });
        if (bestDiv && maxLen > 200) {
            contentNode = bestDiv;
        }
    }

    if (!contentNode) return { title: chapterTitle, content: "" };

    let rawText = "";
    if (contentNode) {
      const junkSelectors = ["script", "style", "iframe", ".ad", ".nav", ".footer"];
      junkSelectors.forEach(sel => {
        contentNode!.querySelectorAll(sel).forEach(el => el.remove());
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
      if (text.includes("下一章") || text.includes("下一页") || text.includes("next")) {
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
