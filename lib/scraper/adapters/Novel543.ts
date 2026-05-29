import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";
import { extensionFetch } from "../extension-bridge";

export const Novel543Adapter: SiteAdapter = {
  name: "Novel543",
  group: "cn",
  urlPattern: /novel543\.com/,
  chapterWaitSelector: ".content.py-5, .content, .chapter-content .content, #content",
  useSequentialTab: false,

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let currentBase = new URL(url);

    let title = "Unknown Title";
    let coverImgStr = "";

    const coverImgEl = doc.querySelector(".novel-cover img, .book-img img, .detail-img img, .m-bookinfo img, .cover img, img[src*='cover'], img[src*='upload'], img[src*='thumb']") || doc.querySelector("img[alt]:not([alt*='logo']):not([alt*='Logo'])");
    if (coverImgEl && coverImgEl.getAttribute("src")) {
      title = coverImgEl.getAttribute("alt") || title;
      coverImgStr = coverImgEl.getAttribute("src") || "";
    }
    if (!title || title === "Unknown Title") {
      title = doc.querySelector("h1")?.textContent?.trim() || doc.title.split("-")[0].trim() || "Unknown Title";
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

      const extractChapterNumber = (titleText: string): number | null => {
        const matchA = titleText.match(/第(\d+)章/);
        if (matchA) return parseInt(matchA[1], 10);

        const matchZh = titleText.match(/第([零一二三四五六七八九十百千]+)章/);
        if (matchZh) {
          const cnNums: Record<string, number> = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '百': 100, '千': 1000 };
          let res = 0; let tmp = 0;
          for (let i = 0; i < matchZh[1].length; i++) {
            const val = cnNums[matchZh[1][i]] || 0;
            if (val === 10 || val === 100 || val === 1000) {
              if (tmp === 0) tmp = 1;
              res += tmp * val;
              tmp = 0;
            } else {
              tmp = val;
            }
          }
          res += tmp;
          return res;
        }
        return null;
      };

      // Sort by chapter number first, then by part number (1/2 before 2/2)
      chs.sort((a, b) => {
        const chA = extractChapterNumber(a.title) ?? Infinity;
        const chB = extractChapterNumber(b.title) ?? Infinity;
        if (chA !== chB) return chA - chB;

        // Same chapter number — sort by part (1/2 before 2/2)
        const partA = a.title.match(/\((\d+)\/\d+\)/);
        const partB = b.title.match(/\((\d+)\/\d+\)/);
        const pA = partA ? parseInt(partA[1], 10) : 1;
        const pB = partB ? parseInt(partB[1], 10) : 1;
        return pA - pB;
      });

      // ── MERGE SPLIT PARTS ──
      const merged: { title: string; url: string; order: number }[] = [];
      const seenChapterNums = new Set<number>();
      const seenRawTitles = new Set<string>();

      for (const ch of chs) {
        const chNum = extractChapterNumber(ch.title);
        const partMatch = ch.title.match(/\((\d+)\/(\d+)\)/);

        if (partMatch) {
          const partNum = parseInt(partMatch[1], 10);
          if (partNum === 1) {
            const cleanTitle = ch.title.replace(/\s*\(\d+\/\d+\)/, "").trim();
            merged.push({ title: cleanTitle, url: ch.url, order: merged.length });
            if (chNum !== null) seenChapterNums.add(chNum);
            seenRawTitles.add(cleanTitle);
          }
        } else {
          // No split marker
          if ((chNum !== null && !seenChapterNums.has(chNum)) || (chNum === null && !seenRawTitles.has(ch.title))) {
            merged.push({ title: ch.title, url: ch.url, order: merged.length });
            if (chNum !== null) seenChapterNums.add(chNum);
            seenRawTitles.add(ch.title);
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
      } catch (e) {
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
        const res = await extensionFetch(potentialNextUrl, {
          waitSelector: Novel543Adapter.chapterWaitSelector,
        });
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

    let finalContent = cleanGarbageLines(rawText);
    // Xoá các câu thông báo rác như 溫馨提示
    finalContent = finalContent.split('\n').filter(line => !line.includes('溫馨提示')).join('\n');

    return {
      title: chapterTitle || "Chương không tên",
      content: finalContent,
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







