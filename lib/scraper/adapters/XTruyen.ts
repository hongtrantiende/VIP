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

    // --- Method: Fallback to crawler mode (Return only first chapter) ---
    // Instead of generating synthetic URLs which might 404, we find the first chapter link
    // and rely on the engine's dynamic `nextChapterUrl` crawler to fetch subsequent chapters.
    const firstChapterNode = 
      doc.querySelector("a.btn-chapter-first") ||
      doc.querySelector("a[href*='/chuong-']") ||
      doc.querySelector("a[href*='/chapter-']");

    if (firstChapterNode) {
      const firstUrl = (firstChapterNode as HTMLAnchorElement).getAttribute("href") || "";
      if (firstUrl) {
        return {
          title,
          author,
          description,
          coverImage,
          chapters: [{ title: "Chương Đầu", url: firstUrl, order: 0 }]
        };
      }
    }

    console.error("XTruyen: Could not determine first chapter link.");
    return { title, author, description, coverImage, chapters: [] };
  },

  async getChapterContent(html, _url, contentText) {
    let rawText = "";

    // 1. Tự động giải mã biến data_x nếu tìm thấy trong HTML (Rất nhanh, không cần mở tab)
    const dataXMatch = html.match(/data_x\s*=\s*["']([^"']+)["']/);
    if (dataXMatch) {
      try {
        const data_x = dataXMatch[1];
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const cipher = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
        let translated = '';
        for (const char of data_x) {
          const idx = cipher.indexOf(char);
          translated += idx > -1 ? alphabet[idx] : char;
        }
        const binary = Uint8Array.from(atob(translated), x => x.charCodeAt(0));
        
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(binary);
        writer.close();
        
        let decryptedHtml = await new Response(ds.readable).text();
        rawText = decryptedHtml.replace(/<(br|hr)\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|section|article|li)>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();
      } catch (e: any) {
        console.error("XTruyen data_x decrypt error:", e.message);
      }
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    const container = doc.querySelector("#chapter-reading-content");

    // 2. Nếu không có data_x, dùng container hoặc contentText làm dự phòng
    if (!rawText) {
      if (!container && !contentText) return { title: "", content: "" };

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
