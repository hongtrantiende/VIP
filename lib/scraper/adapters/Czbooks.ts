import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

export const CzbooksAdapter: SiteAdapter = {
  name: "Czbooks",
  group: "cn",
  urlPattern: /czbooks\.net/,
  chapterWaitSelector: ".content, #content, .chapter-detail",
  useSequentialTab: false,

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
      coverImage: coverImg 
        ? `/api/proxy-image?url=${encodeURIComponent(new URL(coverImg, url).toString())}`
        : undefined,
      chapters,
    };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    const titleTagText = doc.querySelector("title")?.textContent || "";
    console.log("[Czbooks Adapter] --- Bắt đầu trích xuất chương ---");
    console.log("[Czbooks Adapter] URL chương:", _url);
    console.log("[Czbooks Adapter] Thẻ <title> của trang:", titleTagText);

    // Tự động tìm và trích xuất tên tiểu thuyết từ thẻ <title> (Ví dụ: "《謝家的短命鬼長命百歲了》 第1章 庚帖 - CZBOOKS" -> "謝家的短命鬼長命百歲了")
    let novelTitle = "";
    if (titleTagText) {
      const match = titleTagText.match(/《([^》]+)》/);
      if (match) {
        novelTitle = match[1].trim();
      }
    }
    // Fallback: Lấy tên truyện từ h1
    if (!novelTitle) {
      const h1Text = doc.querySelector("h1")?.textContent?.trim() || "";
      novelTitle = h1Text.replace(/[《》「」『』]/g, "").trim();
    }
    console.log("[Czbooks Adapter] Tên truyện đã nhận diện (novelTitle):", novelTitle);

    // Ưu tiên các selector tiêu đề chương thực tế trước h1 (vốn thường là tên truyện trên czbooks)
    let chapterTitle = doc.querySelector(".chapter-title, .name, h2")?.textContent?.trim() || "";
    console.log("[Czbooks Adapter] Tiêu đề lấy từ selector (.chapter-title, .name, h2):", chapterTitle);

    if (!chapterTitle && titleTagText) {
      // Trích xuất phần tiêu đề chương từ thẻ <title> dạng "Tiêu đề - Tên truyện - CZBOOKS"
      const parts = titleTagText.split(/\s+-\s+/);
      if (parts.length > 0) {
        chapterTitle = parts[0].trim();
      }
      console.log("[Czbooks Adapter] Tiêu đề lấy từ thẻ <title>:", chapterTitle);
    }
    if (!chapterTitle) {
      chapterTitle = doc.querySelector("h1")?.textContent?.trim() || "";
      console.log("[Czbooks Adapter] Tiêu đề fallback về h1:", chapterTitle);
    }

    // Tự động dọn dẹp nếu tiêu đề chương bị dính tên truyện
    if (chapterTitle && novelTitle) {
      const beforeCleanup = chapterTitle;
      // Xóa tên truyện có ngoặc 《...》
      chapterTitle = chapterTitle.replace(`《${novelTitle}》`, "").trim();
      // Xóa tên truyện không ngoặc
      chapterTitle = chapterTitle.replace(novelTitle, "").trim();
      console.log("[Czbooks Adapter] Tiêu đề sau khi xóa novelTitle:", beforeCleanup, "->", chapterTitle);
    }

    // Dọn dẹp thêm các dấu ngoặc kép, gạch ngang và khoảng trắng thừa ở hai đầu
    chapterTitle = chapterTitle
      .replace(/^[《》「」『』\s\-—]+/, "")
      .replace(/[《》「」『』\s\-—]+$/, "")
      .trim();
    console.log("[Czbooks Adapter] Tiêu đề sau khi dọn dẹp ngoặc thừa:", chapterTitle);

    // Nếu dọn dẹp xong bị rỗng, fallback về tiêu đề ban đầu trong DOM
    if (!chapterTitle) {
      chapterTitle = doc.querySelector(".chapter-title, .name, h2")?.textContent?.trim() || "Chương mới";
      console.log("[Czbooks Adapter] Tiêu đề bị rỗng sau dọn dẹp, fallback về:", chapterTitle);
    }

    console.log("[Czbooks Adapter] --- Kết thúc trích xuất tiêu đề chương:", chapterTitle, "---");

    // Always parse HTML to remove junk, fall back to contentText if empty

    const contentNode = doc.querySelector(".content, #content, .chapter-detail, .read-content");
    
    let rawText = "";
    if (contentNode) {
      const junkSelectors = ["script", "style", "iframe", ".ad", ".nav", ".footer", ".watermark"];
      junkSelectors.forEach(sel => {
        contentNode.querySelectorAll(sel).forEach(el => el.remove());
      });
      
      let htmlContent = contentNode.innerHTML;
      htmlContent = htmlContent.replace(/<br\s*\/?>/gi, '\n');
      htmlContent = htmlContent.replace(/<p[^>]*>/gi, '\n');
      htmlContent = htmlContent.replace(/<\/p>/gi, '\n');
      
      const tempDiv = doc.createElement("div");
      tempDiv.innerHTML = htmlContent;
      rawText = tempDiv.textContent?.trim() || "";
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
