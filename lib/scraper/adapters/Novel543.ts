import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";
import { extensionFetch } from "../extension-bridge";

export const Novel543Adapter: SiteAdapter = {
  name: "Novel543",
  group: "cn",
  urlPattern: /novel543\.com/,
  useSequentialTab: false,

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let currentBase = new URL(url);

    let title = "Unknown Title";
    let coverImgStr = "";

    const coverImgEl = doc.querySelector("img[src*='thumb'], .cover img, .book-img img, .novel-cover img") || doc.querySelector("img[alt]");
    if (coverImgEl && coverImgEl.getAttribute("alt")) {
      title = coverImgEl.getAttribute("alt") || title;
      coverImgStr = coverImgEl.getAttribute("src") || "";
    } else {
      title = doc.querySelector("h1")?.textContent?.trim() || doc.title.split("-")[0].trim() || title;
    }

    const coverImage = coverImgStr 
      ? `/api/proxy-image?url=${encodeURIComponent(new URL(coverImgStr, currentBase).toString())}`
      : undefined;

    // Helper to parse chapters
    const parseChapters = (targetDoc: Document, targetUrl: string) => {
      const urlMap = new Map<string, { title: string; url: string }>();

      const links = Array.from(targetDoc.querySelectorAll("ul.flex a[href*='.html'], .chapter-list a, .dir-list a"));

      links.forEach((link) => {
        const href = link.getAttribute("href");
        if (!href) return;

        const titleText = link.textContent?.trim() || "";
        if (titleText.length < 2) return;

        if (!titleText.includes("章") && !titleText.includes("第") && !titleText.match(/\d/)) {
          return;
        }

        const fullUrl = new URL(href, targetUrl).toString();
        const cleanUrl = fullUrl.split("#")[0].split("?")[0];

        if (!cleanUrl.includes("novel543.com")) return;

        urlMap.delete(cleanUrl);
        urlMap.set(cleanUrl, { title: titleText, url: cleanUrl });
      });

      const chs = Array.from(urlMap.values());
      
      // Sort by chapter number first, then by part number (1/2 before 2/2)
      chs.sort((a, b) => {
        const matchA = a.title.match(/第(\d+)章/);
        const matchB = b.title.match(/第(\d+)章/);
        const chA = matchA ? parseInt(matchA[1], 10) : Infinity;
        const chB = matchB ? parseInt(matchB[1], 10) : Infinity;
        if (chA !== chB) return chA - chB;

        // Same chapter number — sort by part (1/2 before 2/2)
        const partA = a.title.match(/\((\d+)\/\d+\)/);
        const partB = b.title.match(/\((\d+)\/\d+\)/);
        const pA = partA ? parseInt(partA[1], 10) : 1;
        const pB = partB ? parseInt(partB[1], 10) : 1;
        return pA - pB;
      });

      // ── MERGE SPLIT PARTS ──
      // Chapters split into (1/2), (2/2), etc. → keep only (1/N) URL (first page).
      // The adapter's getChapterContent will follow 下一頁 links to fetch remaining parts.
      const merged: { title: string; url: string; order: number }[] = [];
      const seenChapterNums = new Set<number>();

      for (const ch of chs) {
        const chNumMatch = ch.title.match(/第(\d+)章/);
        const chNum = chNumMatch ? parseInt(chNumMatch[1], 10) : null;
        const partMatch = ch.title.match(/\((\d+)\/(\d+)\)/);

        if (partMatch) {
          const partNum = parseInt(partMatch[1], 10);
          // Only keep the first part — subsequent parts will be fetched automatically
          if (partNum === 1) {
            const cleanTitle = ch.title.replace(/\s*\(\d+\/\d+\)/, "").trim();
            merged.push({ title: cleanTitle, url: ch.url, order: merged.length });
            if (chNum !== null) seenChapterNums.add(chNum);
          }
          // Skip parts 2, 3, etc. — they will be fetched by getChapterContent
        } else {
          // No split marker — check we haven't already added this chapter number
          if (chNum === null || !seenChapterNums.has(chNum)) {
            merged.push({ title: ch.title, url: ch.url, order: merged.length });
            if (chNum !== null) seenChapterNums.add(chNum);
          }
        }
      }

      return merged;
    };

    let chapters = parseChapters(doc, url);

    const tocLink = doc.querySelector("a[href$='/dir'], a[href*='dir']");
    if (tocLink && !url.endsWith("dir") && !url.endsWith("dir/")) {
      const href = tocLink.getAttribute("href")!;
      const tocUrl = new URL(href, currentBase).toString();
      try {
         const res = await extensionFetch(tocUrl);
         const tocDoc = new DOMParser().parseFromString(res.html, "text/html");
         const fullChapters = parseChapters(tocDoc, tocUrl);
         if (fullChapters.length > 0) {
           chapters = fullChapters;
         }
      } catch(e) {
         console.warn("Failed to fetch TOC", e);
      }
    }

    if (chapters.length === 0) {
      throw new Error("Không tìm thấy danh sách chương trên trang này.");
    }

    return {
      title,
      coverImage,
      chapters,
    };
  },

  async getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    // Hàm làm sạch tiêu đề để so sánh chính xác (loại bỏ mọi định dạng đánh số trang)
    const cleanTitleText = (t: string) => {
      if (!t) return "";
      return t.replace(/\s*[\(（\[【]\s*\d+\s*\/\s*\d+\s*[\)）\]】]/g, "").trim();
    };

    // Lấy tiêu đề thô từ các nguồn có thể có
    const getRawTitle = (d: Document) => {
      return d.querySelector("h1")?.textContent?.trim() || 
             d.querySelector(".chapter-title")?.textContent?.trim() || 
             d.title.split("-")[0].trim() || 
             "";
    };

    const chapterTitle = cleanTitleText(getRawTitle(doc));

    const extractText = (d: Document): string => {
      const contentNode = d.querySelector(".content.py-5") || 
                          d.querySelector(".content") || 
                          d.querySelector(".chapter-content .content") ||
                          d.querySelector("#content");
                          
      if (!contentNode) return "";

      const junk = [".gadBlock", "ins", "[data-ad]", "iframe", "script", ".adBlock", ".float-wrap", ".foot-nav", "footer", ".modal"];
      junk.forEach(sel => contentNode.querySelectorAll(sel).forEach(el => el.remove()));

      let h = contentNode.innerHTML
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<p[^>]*>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/&nbsp;/g, " ");

      const tmp = d.createElement("div");
      tmp.innerHTML = h;
      return tmp.textContent?.trim() || "";
    };

    let rawText = extractText(doc) || contentText || "";
    let nextChapterUrl = "";

    // ==================== TỰ ĐỘNG CRAWL VÀ GỘP PHẦN ====================
    let currentDoc = doc;
    let currentUrl = _url;
    let safety = 0;

    while (safety < 12) {
      safety++;

      // Tìm bất kỳ link nào có vẻ là "Tiếp theo"
      const potentialNextUrl = getAnyNextUrl(currentDoc, currentUrl);
      if (!potentialNextUrl || potentialNextUrl === currentUrl) break;

      try {
        const res = await extensionFetch(potentialNextUrl);
        const nextDoc = new DOMParser().parseFromString(res.html, "text/html");
        
        // Lấy tiêu đề của trang vừa tải và làm sạch
        const nextTitle = cleanTitleText(getRawTitle(nextDoc));
        
        // NẾU TIÊU ĐỀ GIỐNG NHAU -> Đây là phần tiếp theo của CÙNG MỘT CHƯƠNG
        if (nextTitle === chapterTitle || !chapterTitle || !nextTitle) {
          const nextText = extractText(nextDoc);
          if (nextText.length > 50) {
            rawText += "\n\n" + nextText;
          }
          currentDoc = nextDoc;
          currentUrl = potentialNextUrl;
        } 
        // NẾU TIÊU ĐỀ KHÁC NHAU -> Đây thực sự là CHƯƠNG MỚI
        else {
          nextChapterUrl = potentialNextUrl;
          break; // Dừng vòng lặp gộp
        }
      } catch (e) {
        console.warn("[Novel543] Loop merge error:", e);
        break;
      }
    }

    // Nếu thoát vòng lặp mà chưa xác định được nextChapterUrl (chưa bấm sang trang có tiêu đề mới)
    if (!nextChapterUrl) {
      nextChapterUrl = getAnyNextUrl(currentDoc, currentUrl, true); // true để ưu tiên "下一章"
    }

    return {
      title: chapterTitle || "Chương không tên",
      content: cleanGarbageLines(rawText),
      nextChapterUrl
    };
  },
};

// ==================== HELPERS ====================
const getAnyNextUrl = (d: Document, base: string, preferChapter = false): string => {
  const links = Array.from(d.querySelectorAll("a[href]"));
  
  // Các text thường dùng cho nút "Tiếp theo"
  const markers = ["下一頁", "下一页", "下頁", "下页", "下一章"];
  
  for (const marker of markers) {
    if (preferChapter && marker !== "下一章") continue;
    
    for (const a of links) {
      const text = a.textContent?.trim() || "";
      if (text.includes(marker)) {
        const href = a.getAttribute("href");
        // Bỏ qua link javascript hoặc link về trang danh sách
        if (href && !href.startsWith("javascript") && !href.includes("dir")) {
          return new URL(href, base).toString();
        }
      }
    }
  }
  return "";
};







