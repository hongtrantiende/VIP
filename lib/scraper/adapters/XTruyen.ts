import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter, ChapterLink } from "../types";
import { extensionFetch } from "../extension-bridge";

/**
 * Adapter for XTruyen.vn
 *
 * Strategy: XTruyen uses a WordPress manga theme where chapters are hidden
 * behind dynamic AJAX loading. However, chapter URLs follow a predictable
 * pattern: `{novel_url}/chuong-{N}/`
 *
 * We extract the last chapter number from the info page (the "Chương cuối"
 * link) and generate all chapter URLs from 1 to N, which is far more
 * reliable than trying to scrape the dynamically-loaded chapter list.
 */
export const XTruyenAdapter: SiteAdapter = {
  name: "XTruyen",
  group: "vn",
  urlPattern: /xtruyen\.vn/,
  useSequentialTab: true,
  chapterWaitSelector: "#chapter-reading-content",

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // --- Extract basic info ---
    const title =
      doc.querySelector(".post-title h1")?.textContent?.trim() ||
      doc.querySelector("h1")?.textContent?.trim() ||
      "";

    const author =
      doc.querySelector(".author-content a")?.textContent?.trim() ||
      "Đang cập nhật";

    const coverImage =
      doc.querySelector(".summary_image img")?.getAttribute("src") || "";

    const description =
      doc.querySelector(".description-summary .summary__content")
        ?.textContent?.trim() || "";

    // --- Handle case where user inputs a chapter URL directly ---
    if (url.includes("/chuong-") || url.includes("/chapter-")) {
      const chapterTitle =
        doc.querySelector(".breadcrumb li.active")?.textContent?.trim() ||
        "Chương Đầu";
      const novelTitle =
        doc.querySelector(".breadcrumb li:nth-last-child(2) a")
          ?.textContent?.trim() ||
        title ||
        "Truyện Crawl";

      return {
        title: novelTitle,
        author: "Đang cập nhật",
        description: "",
        coverImage: "",
        chapters: [{ title: chapterTitle, url, order: 0 }],
      };
    }

    // --- Determine total chapter count ---
    // Method 1: Look for "Chương cuối" link which contains the last chapter number
    let lastChapterNum = 0;

    const allLinks = Array.from(doc.querySelectorAll("a[href]"));
    for (const a of allLinks) {
      const href = (a as HTMLAnchorElement).getAttribute("href") || "";
      const match = href.match(/\/chuong-(\d+)\/?$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > lastChapterNum) lastChapterNum = num;
      }
    }

    // Method 2: Look in script tags for chapter count info
    if (!lastChapterNum) {
      const scripts = Array.from(doc.querySelectorAll("script"));
      for (const s of scripts) {
        const content = s.textContent || "";
        const m = content.match(/chuong-(\d+)/g);
        if (m) {
          for (const c of m) {
            const num = parseInt(c.replace("chuong-", ""), 10);
            if (num > lastChapterNum) lastChapterNum = num;
          }
        }
      }
    }

    // Method 3: Look in the raw HTML text as last resort
    if (!lastChapterNum) {
      const rawMatches = html.match(/chuong-(\d+)/g);
      if (rawMatches) {
        for (const c of rawMatches) {
          const num = parseInt(c.replace("chuong-", ""), 10);
          if (num > lastChapterNum) lastChapterNum = num;
        }
      }
    }

    if (!lastChapterNum) {
      console.error("XTruyen: Could not determine total chapter count.");
      return { title, author, description, coverImage, chapters: [] };
    }

    // --- Generate all chapter URLs ---
    const baseUrl = url.split("?")[0].replace(/\/$/, "");
    const chapters: ChapterLink[] = [];

    for (let i = 1; i <= lastChapterNum; i++) {
      chapters.push({
        title: `Chương ${i}`,
        url: `${baseUrl}/chuong-${i}/`,
        order: i - 1,
      });
    }

    onProgress?.(chapters.length);
    console.log(`XTruyen: Generated ${chapters.length} chapter URLs (1 → ${lastChapterNum})`);

    return { title, author, description, coverImage, chapters };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const container = doc.querySelector("#chapter-reading-content");

    if (!container && !contentText) return { title: "", content: "" };

    let rawText = "";

    // Luôn ưu tiên dùng container nếu tìm thấy để lấy toàn bộ các đoạn văn
    if (container) {
      // Xóa quảng cáo, mã nhúng và vòng xoay loading
      container
        .querySelectorAll(".aam-ad-container, .carousel, script, style, .ads, .quangcao, #loading-box")
        .forEach((el) => el.remove());

      let htmlContent = (container as HTMLElement).innerHTML || "";
      rawText = htmlContent.replace(/<(br|hr)\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
        
      if (!rawText) rawText = contentText || "";
    } else {
      // Chỉ dùng contentText làm dự phòng
      rawText = contentText || "";
    }

    const title =
      doc.querySelector(".breadcrumb li.active")?.textContent?.trim() || "";

    // Find Next Chapter Link
    const nextChapterUrl =
      (doc.querySelector("a.next_page") as HTMLAnchorElement)?.href || "";

    // Clean up
    let text = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (line.includes("MonkeyD.net.vn")) return false;
        if (line.includes("________________________________________"))
          return false;
        if (line.includes("xtruyen.vn")) return false;
        return true;
      })
      .join("\n\n");

    text = cleanGarbageLines(text);

    return { title, content: text, nextChapterUrl };
  },
};
