/**
 * Server-side scraper using cheerio for fast HTML fetching & parsing.
 * No extension needed — runs on the server via Next.js API routes.
 *
 * This complements the extension-bridge approach:
 * - Server fetch: Fast, no CORS issues, but only works for static HTML pages
 * - Extension fetch: Slower, but handles JS-rendered & anti-bot pages
 */

import * as cheerio from "cheerio";
import iconv from "iconv-lite";

// ─── Types ────────────────────────────────────────────────────

export interface ServerNovelInfo {
  title: string;
  author: string | null;
  coverImage: string | null;
  description: string | null;
  chapters: { title: string; url: string }[];
  /** Detected pagination URLs (next pages of chapter list) */
  paginationUrls: string[];
  /** Detected TOC URL if main page links to a separate table of contents */
  tocUrl: string | null;
}

export interface ServerChapterContent {
  title: string;
  content: string[];
  /** CSS selector that was used to find the content container */
  contentSelector: string;
  /** Number of <p> tags found in the content area */
  paragraphCount: number;
}

export interface AnalyzedSelectors {
  titleSelector: string;
  coverSelector: string;
  chapterListSelector: string;
  chapterTitleSelector: string;
  contentSelector: string;
  sampleChapterUrl: string | null;
}

// ─── Core fetch ───────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
];

export async function fetchHtml(url: string): Promise<string> {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store", // Prevent Next.js from caching old broken HTML
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7,zh-CN;q=0.6,zh;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Decode GBK if necessary
    const hostname = new URL(url).hostname;
    if (hostname.includes("piaotia.com") || hostname.includes("jjwxc.net")) {
      return iconv.decode(buffer, "gbk");
    }

    return buffer.toString("utf8");
  } finally {
    clearTimeout(timeout);
  }
}

// ─── CSS Selector Helper ──────────────────────────────────────

function getBestSelector($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): string {
  const id = el.attr("id");
  if (id) return `#${id}`;

  const classStr = el.attr("class");
  if (classStr) {
    const classes = classStr
      .trim()
      .split(/\s+/)
      .filter((c: string) => c.length > 0 && !c.includes(":") && !c.includes("["));
    if (classes.length > 0) {
      return `.${classes.slice(0, 3).join(".")}`;
    }
  }

  const tagName = el.prop("tagName")?.toLowerCase() || "div";
  return tagName;
}

// ─── Novel Page Analysis ──────────────────────────────────────

export async function analyzeNovelPage(url: string): Promise<ServerNovelInfo> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // 1. Title — extract and clean
  let rawTitle =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    "Không rõ tên truyện";

  // Clean common suffixes: 【xxx】,最新章节,免費閱讀 - SiteName
  const title = rawTitle
    .replace(/[,，]\s*最新章[节節].*$/i, "")
    .replace(/\s*[-–—|]\s*(糯米書棧|快看小說|腐看天地|chomered|welove).*$/i, "")
    .replace(/^【(.+?)】$/, "$1")  // Remove 【】 brackets
    .trim() || rawTitle;

  // 2. Author
  let author: string | null = null;
  const authorRegex = /(tác giả|author|tac gia|作者)[:\s]*([^|\n<]+)/i;
  const authorMatch = html.match(authorRegex);
  if (authorMatch) {
    author = authorMatch[2].trim();
  } else {
    author = $(".author, .tac-gia, a[href*='tac-gia'], a[href*='author']").first().text().trim() || null;
  }

  // 3. Cover Image
  let coverImage =
    $('meta[property="og:image"]').attr("content") ||
    $("img").filter((_i, el) => {
      const src = $(el).attr("src") || "";
      const cls = $(el).attr("class") || "";
      const alt = $(el).attr("alt") || "";
      return src.includes("cover") || cls.includes("cover") || alt.includes("cover") || src.includes("thumb");
    }).first().attr("src") ||
    null;

  if (coverImage && !coverImage.startsWith("http")) {
    coverImage = new URL(coverImage, url).toString();
  }

  // 4. Description
  const description =
    $('meta[property="og:description"]').attr("content")?.trim() ||
    $(".description, .book-desc, .story-desc").first().text().trim() ||
    null;

  // 5. Chapter List
  const chapters: { title: string; url: string }[] = [];
  const seenUrls = new Set<string>();

  // Helper to add a chapter link
  const addChapter = (text: string, href: string) => {
    try {
      const absoluteUrl = new URL(href, url).toString();
      // Skip links that point back to the current page (same URL)
      const cleanUrl = absoluteUrl.split("#")[0].split("?")[0];
      const cleanBase = url.split("#")[0].split("?")[0];
      if (cleanUrl === cleanBase) return;
      // Skip obvious navigation links
      const navWords = /^(首[頁页]|專題|書庫|排行|我的|瀏覽|訂閱|登[录錄]|熱門|library|rank|topic|user|privacy|contact|more|首页)$/i;
      if (navWords.test(text.trim())) return;

      if (!seenUrls.has(absoluteUrl) && text.length > 0) {
        chapters.push({ title: text.replace(/\s+/g, " ").trim(), url: absoluteUrl });
        seenUrls.add(absoluteUrl);
      }
    } catch { }
  };

  // ── Site-specific: chomered.com / welove-gourmet.com ──
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  if (hostname.includes("chomered.com") || hostname.includes("welove-gourmet.com")) {
    // These sites use /book/chapter/ID for chapter URLs
    // First pass: collect all unique chapter URLs
    const chapterUrlSet = new Set<string>();
    $("a").each((_i, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("/book/chapter/")) {
        try { chapterUrlSet.add(new URL(href, url).toString()); } catch { }
      }
    });

    // Second pass: pick the cleanest text for each URL (from the list section, not nav buttons)
    const chapterMap = new Map<string, string>();
    $("a").each((_i, el) => {
      const href = $(el).attr("href") || "";
      if (!href.includes("/book/chapter/")) return;

      let absUrl: string;
      try { absUrl = new URL(href, url).toString(); } catch { return; }

      const rawText = $(el).text().trim();
      // Skip nav-like texts: 繼續閱讀 (continue reading), 最新 (latest), etc.
      if (/繼續閱[讀读]|最新|免[费費]|閱讀/i.test(rawText) && !/第\d+章/.test(rawText)) return;

      // Clean text: "1 第1章 免费" → "第1章", "10-28 最新 第6章" → "第6章"
      let cleanText = rawText
        .replace(/免[费費]/g, "")
        .replace(/\d+-\d+\s*最新\s*/g, "")
        .replace(/^\d+\s+/, "")
        .trim();

      if (!cleanText) return;

      // Prefer text that looks like a chapter title (第X章)
      const existing = chapterMap.get(absUrl);
      if (!existing || (/第\d+章/.test(cleanText) && !/第\d+章/.test(existing))) {
        chapterMap.set(absUrl, cleanText);
      }
    });

    // Sort by chapter ID (numeric part of URL) and add
    const sortedEntries = [...chapterMap.entries()].sort((a, b) => {
      const idA = parseInt(a[0].split("/").pop() || "0");
      const idB = parseInt(b[0].split("/").pop() || "0");
      return idA - idB;
    });

    for (const [chUrl, chTitle] of sortedEntries) {
      addChapter(chTitle, chUrl);
    }
  }

  // Strategy A: Links matching chapter patterns (Vietnamese + Chinese + English)
  if (chapters.length === 0) {
    $("a").each((_i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();

      if (!href || !text || text.length < 2) return;

      const hrefLow = href.toLowerCase();
      const textLow = text.toLowerCase();
      const clsLow = ($(el).attr("class") || "").toLowerCase();

      const isChapter =
        // Vietnamese
        textLow.includes("chương") || textLow.includes("chap ") ||
        hrefLow.includes("chuong") || hrefLow.includes("/chap") ||
        // English
        textLow.includes("chapter") || hrefLow.includes("chapter") ||
        // Chinese: 第X章, 第X节, 第X回
        /第\s*[\d一二三四五六七八九十百千万零〇]+\s*[章节回卷集话]/.test(text) ||
        // Class-based
        clsLow.includes("chap") ||
        // Parent container based
        $(el).closest(".list-chapter, .chapter-list, #list-chapter, ul.chapters, #chapterList, #list, .catalog-list, .mulu-list").length > 0;

      if (isChapter) {
        addChapter(text, href);
      }
    });
  }

  // Strategy A.5: Try known novel site selectors
  if (chapters.length === 0) {
    const knownSelectors = [
      "#list dd a",              // piaotia, uukanshu, 69shu
      "#chapterList li a",       // many Chinese sites
      "#chapterlist li a",       // case insensitive variant
      ".chapterlist a",          // class-based
      "ul.catalog-list a",       // some sites
      "#readerlists a",          // reader list
      ".ajaxchapterlist a",      // ajax loaded
      ".list-chapter a",        // Vietnamese sites
      "#list-chapter a",
      "ul.chapters a",
    ];

    for (const sel of knownSelectors) {
      try {
        const found = $(sel);
        if (found.length > 3) {
          found.each((_i, el) => {
            const href = $(el).attr("href");
            const text = $(el).text().trim();
            if (href && text) addChapter(text, href);
          });
          if (chapters.length > 0) break;
        }
      } catch { }
    }
  }

  // Strategy B: Fallback — find container with most links
  if (chapters.length === 0) {
    let bestContainer: cheerio.Cheerio<any> | null = null;
    let maxLinks = 0;
    $("div, ul, dd, section").each((_i, el) => {
      // Count direct <a> children OR <a> within <dd>/<li> children
      const directLinks = $(el).children("a").length;
      const nestedLinks = $(el).find("li a, dd a").length;
      const linkCount = Math.max(directLinks, nestedLinks);
      if (linkCount > maxLinks && linkCount > 3) {
        maxLinks = linkCount;
        bestContainer = $(el);
      }
    });

    if (bestContainer) {
      (bestContainer as cheerio.Cheerio<any>).find("a").each((_i, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        if (href && text) addChapter(text, href);
      });
    }
  }

  // 6. MeTruyenChu pagination (special handling)
  const paginationUrls: string[] = [];
  const mtcPageLinks = $('a[onclick^="page("]');
  if (mtcPageLinks.length > 0) {
    const firstOnClick = mtcPageLinks.first().attr("onclick") || "";
    const match = firstOnClick.match(/page\((\d+)/);
    if (match?.[1]) {
      const storyId = match[1];
      let maxPage = 2;
      mtcPageLinks.each((_i, el) => {
        const m = ($(el).attr("onclick") || "").match(/page\(\d+,(\d+)\)/);
        if (m?.[1]) maxPage = Math.max(maxPage, parseInt(m[1]));
      });

      const origin = new URL(url).origin;
      for (let p = 2; p <= maxPage; p++) {
        paginationUrls.push(`${origin}/get/listchap/${storyId}?page=${p}`);
      }

      // Fetch first 5 extra pages
      for (let p = 2; p <= Math.min(maxPage, 5); p++) {
        try {
          const pageHtml = await fetchHtml(`${origin}/get/listchap/${storyId}?page=${p}`);
          let actualHtml = pageHtml;
          try {
            const parsed = JSON.parse(pageHtml);
            if (parsed?.data) actualHtml = parsed.data;
          } catch { }

          const $p = cheerio.load(actualHtml);
          $p("a").each((_i, el) => {
            const text = $p(el).text().toLowerCase();
            const href = $p(el).attr("href")?.toLowerCase() || "";
            if (text.includes("chương") || text.includes("chapter") || href.includes("chuong") || href.includes("chapter")) {
              const pTitle = $p(el).text().trim().replace(/\s+/g, " ");
              const pHref = $p(el).attr("href");
              if (pHref && pTitle) {
                let chapUrl = pHref;
                if (!chapUrl.startsWith("http")) {
                  chapUrl = chapUrl.startsWith("/") ? `${origin}${chapUrl}` : `${origin}/${chapUrl}`;
                }
                if (!seenUrls.has(chapUrl)) {
                  chapters.push({ title: pTitle, url: chapUrl });
                  seenUrls.add(chapUrl);
                }
              }
            }
          });
        } catch { }
      }
    }
  }

  // 7. Generic pagination detection
  let tocUrl: string | null = null;
  $("a").each((_i, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr("href");
    if (href && /mục lục|danh sách chương|tất cả chương|full list|xem thêm/i.test(text)) {
      try {
        tocUrl = new URL(href, url).toString();
      } catch { }
    }
  });

  // Also detect standard pagination
  $("ul.pagination a, .pagination a, a[rel='next']").each((_i, el) => {
    const href = $(el).attr("href");
    if (href) {
      try {
        const pageUrl = new URL(href, url).toString();
        if (!paginationUrls.includes(pageUrl)) {
          paginationUrls.push(pageUrl);
        }
      } catch { }
    }
  });

  return { title, author, coverImage, description, chapters, paginationUrls, tocUrl };
}

// ─── Chapter Content Analysis ─────────────────────────────────

export async function analyzeChapterPage(url: string): Promise<ServerChapterContent> {
  const html = await fetchHtml(url);
  return parseChapterHtml(html, url);
}

/**
 * Parse chapter content from pre-fetched HTML (no network request).
 * Used by CloakBrowser fallback path.
 */
export function parseChapterHtml(html: string, url: string): ServerChapterContent {
  const $ = cheerio.load(html);

  // Title
  let title = "";
  const h1Text = $("h1").first().text().trim();
  const chapterTitleClass = $(".chapter-title, .chaptitle, .title-chuong, h2").first().text().trim();

  // Ignore generic navigation h1 tags
  const isGenericH1 = /^(熱門|首页|首页|书库|排行榜|我的|书架)$/i.test(h1Text);

  if (chapterTitleClass && (chapterTitleClass.toLowerCase().includes("chương") || chapterTitleClass.toLowerCase().includes("chapter") || chapterTitleClass.includes("第"))) {
    // If we find an explicit chapter title element that looks like a chapter, use it first
    title = chapterTitleClass;
  } else if (h1Text && !isGenericH1) {
    title = h1Text;
  } else if (chapterTitleClass) {
    title = chapterTitleClass;
  } else {
    // If no h1 or it's a generic word, extract from <title>
    const titleTag = $("title").text().trim();
    if (titleTag) {
      // Sites often format title as "Novel Name - Chapter X" or similar
      const parts = titleTag.split(/[-_—|]/);
      if (parts.length > 1) {
        // Find a part that looks like a chapter (第X章)
        const chapterPart = parts.find(p => /第.+[章回节]/.test(p));
        if (chapterPart) {
          title = chapterPart.trim();
        } else {
          // Fallback to the last part
          title = parts[parts.length - 1].trim();
        }
      } else {
        title = titleTag;
      }
    }
  }

  // Clean up any newlines or excess spaces that might have been captured
  title = title.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

  // Specific fix for MTC where title might be "Novel Name Chương X" 
  if (title.includes("Chương") && !title.startsWith("Chương")) {
    const match = title.match(/(Chương\s*\d+.*)/i);
    if (match) title = match[1];
  }

  // Clean title
  title = title.replace(/^【.+?】/, "").trim() || "Chương không rõ";

  // Content - try common selectors first
  let contentContainer = $("#chapter-c, .chapter-content, .chapter-c, #chapter-content, .reading-content, #content, .content, #vung_doc, .reading-detail");
  let usedSelector = contentContainer.length > 0 ? getBestSelector($, contentContainer.first()) : "";

  // Fallback: find div with most <p> tags
  if (contentContainer.length === 0 || contentContainer.text().trim().length < 100) {
    let maxPCount = 0;
    let bestEl: cheerio.Cheerio<any> | null = null;
    $("div, article, main, section").each((_i, el) => {
      const pCount = $(el).children("p").length;
      if (pCount > maxPCount) {
        maxPCount = pCount;
        bestEl = $(el);
      }
    });

    if (bestEl && maxPCount > 3) {
      contentContainer = bestEl;
      usedSelector = getBestSelector($, bestEl);
    }
  }

  // Fallback 2: div with longest text and no child divs
  if (contentContainer.length === 0 || contentContainer.text().trim().length < 100) {
    let maxLen = 0;
    let bestEl: cheerio.Cheerio<any> | null = null;
    $("div").each((_i, el) => {
      const len = $(el).text().length;
      if (len > maxLen && $(el).children("div").length === 0) {
        maxLen = len;
        bestEl = $(el);
      }
    });
    if (bestEl) {
      contentContainer = bestEl;
      usedSelector = getBestSelector($, bestEl);
    }
  }

  const paragraphs: string[] = [];
  let paragraphCount = 0;

  if (contentContainer.length > 0) {
    // Try splitting by <br> first
    const rawHtml = contentContainer.html() || "";
    rawHtml.split(/<br\s*\/?>/i).forEach((part) => {
      const cleanText = cheerio.load(`<div>${part}</div>`)("div").text().trim();
      if (cleanText && cleanText.length > 1) paragraphs.push(cleanText);
    });

    // If <br> splitting didn't yield much, try <p> tags
    if (paragraphs.length < 3) {
      paragraphs.length = 0;
      contentContainer.find("p").each((_i, el) => {
        const pText = $(el).text().trim();
        if (pText && pText.length > 1) paragraphs.push(pText);
      });
      paragraphCount = contentContainer.find("p").length;
    } else {
      paragraphCount = paragraphs.length;
    }
  }

  return {
    title,
    content: paragraphs,
    contentSelector: usedSelector,
    paragraphCount,
  };
}

// ─── Auto Selector Analyzer ──────────────────────────────────

export async function analyzeSelectors(url: string): Promise<AnalyzedSelectors> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // Title selector
  let titleSelector = "";
  if ($('meta[property="og:title"]').length > 0) {
    titleSelector = 'meta[property="og:title"] → content attribute';
  } else if ($("h1").length > 0) {
    titleSelector = `${getBestSelector($, $("h1").first())}`;
  } else {
    titleSelector = "<title>";
  }

  // Cover selector
  let coverSelector = "";
  if ($('meta[property="og:image"]').length > 0) {
    coverSelector = 'meta[property="og:image"] → content attribute';
  } else {
    const covers = $("img").filter((_i, el) => {
      const src = $(el).attr("src") || "";
      const cls = $(el).attr("class") || "";
      return src.includes("cover") || cls.includes("cover") || src.includes("thumb");
    });
    if (covers.length > 0) {
      coverSelector = `img ${getBestSelector($, covers.first())}`;
    } else {
      coverSelector = "Không tìm thấy tự động — cần check thủ công";
    }
  }

  // Chapter list selector
  let chapterListSelector = "";
  let sampleChapterUrl: string | null = null;

  const chapLinks = $("a").filter((_i, el) => {
    const text = $(el).text().toLowerCase();
    const href = $(el).attr("href")?.toLowerCase() || "";
    const cls = $(el).attr("class")?.toLowerCase() || "";
    return (
      text.includes("chương") ||
      text.includes("chapter") ||
      href.includes("chuong") ||
      href.includes("chapter") ||
      cls.includes("chap")
    );
  });

  if (chapLinks.length > 0) {
    const listContainer = chapLinks.first().closest("ul, div[class*='list'], div[id*='list']");
    if (listContainer.length > 0) {
      chapterListSelector = `${getBestSelector($, listContainer)} a`;
    } else {
      chapterListSelector = `a${getBestSelector($, chapLinks.first())}`;
    }
    try {
      sampleChapterUrl = new URL(chapLinks.first().attr("href") || "", url).toString();
    } catch { }
  } else {
    let bestList: cheerio.Cheerio<any> | null = null;
    let maxLinks = 0;
    $("div, ul").each((_i, el) => {
      const count = $(el).children("a").length;
      if (count > maxLinks && count > 5) {
        maxLinks = count;
        bestList = $(el);
      }
    });
    if (bestList) {
      chapterListSelector = `${getBestSelector($, bestList)} a`;
      try {
        sampleChapterUrl = new URL((bestList as cheerio.Cheerio<any>).find("a").first().attr("href") || "", url).toString();
      } catch { }
    } else {
      chapterListSelector = "Không tìm thấy — cần URL trang mục lục";
    }
  }

  // Chapter content selectors (from sample chapter)
  let chapterTitleSelector = "";
  let contentSelector = "";

  if (sampleChapterUrl) {
    try {
      const chapHtml = await fetchHtml(sampleChapterUrl);
      const $c = cheerio.load(chapHtml);

      // Chapter title
      if ($c("h1").length > 0) {
        chapterTitleSelector = getBestSelector($c, $c("h1").first());
      } else if ($c(".chaptitle, .chapter-title, .title-chuong").length > 0) {
        chapterTitleSelector = getBestSelector($c, $c(".chaptitle, .chapter-title, .title-chuong").first());
      } else {
        chapterTitleSelector = "<title>";
      }

      // Content container
      let maxPCount = 0;
      let bestContainer: cheerio.Cheerio<any> | null = null;
      $c("div, main, section, article").each((_i, el) => {
        const pCount = $c(el).children("p").length;
        if (pCount > maxPCount) {
          maxPCount = pCount;
          bestContainer = $c(el);
        }
      });

      if (bestContainer && maxPCount > 3) {
        contentSelector = `${getBestSelector($c, bestContainer)} p`;
      } else {
        // Fallback: longest text div
        let maxLen = 0;
        $c("div").each((_i, el) => {
          const len = $c(el).text().length;
          if (len > maxLen && $c(el).children("div").length === 0) {
            maxLen = len;
            bestContainer = $c(el);
          }
        });
        if (bestContainer) {
          contentSelector = getBestSelector($c, bestContainer);
        } else {
          contentSelector = "Không tìm thấy tự động";
        }
      }
    } catch (err) {
      chapterTitleSelector = `(Lỗi truy cập chương mẫu: ${sampleChapterUrl})`;
      contentSelector = "(Lỗi)";
    }
  } else {
    chapterTitleSelector = "(Chưa có chương mẫu)";
    contentSelector = "(Chưa có chương mẫu)";
  }

  return {
    titleSelector,
    coverSelector,
    chapterListSelector,
    chapterTitleSelector,
    contentSelector,
    sampleChapterUrl,
  };
}

// ─── Prompt Generator ─────────────────────────────────────────

export async function generateScrapingPrompt(url: string): Promise<string> {
  const selectors = await analyzeSelectors(url);

  let prompt = `Bạn hãy đóng vai là một lập trình viên TypeScript chuyên nghiệp.\n`;
  prompt += `Hãy viết một SiteAdapter (interface) để cào dữ liệu truyện từ website: ${url}\n\n`;

  prompt += `⚠️ LƯU Ý QUAN TRỌNG:\n`;
  prompt += `- Trang web có thể chứa danh sách chương cực lớn, phân trang bằng AJAX.\n`;
  prompt += `- Nếu trang dùng font obfuscation (mã hóa font), cần sử dụng contentText (innerText từ DOM thật) thay vì HTML.\n`;
  prompt += `- Nếu có phân trang, cần hỗ trợ vòng lặp click/fetch các trang tiếp theo.\n\n`;

  prompt += `📋 CSS SELECTORS ĐÃ NHẬN DIỆN TỰ ĐỘNG:\n\n`;
  prompt += `[ THÔNG TIN TRUYỆN ]\n`;
  prompt += `- Tên truyện: ${selectors.titleSelector}\n`;
  prompt += `- Ảnh bìa: ${selectors.coverSelector}\n`;
  prompt += `- Danh sách chương: ${selectors.chapterListSelector}\n\n`;

  prompt += `[ NỘI DUNG CHƯƠNG ]\n`;
  prompt += `(Chương mẫu: ${selectors.sampleChapterUrl || "N/A"})\n`;
  prompt += `- Tiêu đề chương: ${selectors.chapterTitleSelector}\n`;
  prompt += `- Nội dung chữ: ${selectors.contentSelector}\n\n`;

  prompt += `Hãy cung cấp code SiteAdapter hoàn chỉnh theo interface sau:\n`;
  prompt += `\`\`\`typescript\n`;
  prompt += `interface SiteAdapter {\n`;
  prompt += `  name: string;\n`;
  prompt += `  urlPattern: RegExp;\n`;
  prompt += `  chapterWaitSelector?: string;\n`;
  prompt += `  chapterClickSelector?: string;\n`;
  prompt += `  getNovelInfo(html: string, url: string): NovelInfo;\n`;
  prompt += `  getChapterContent(html: string, url: string, contentText?: string): ChapterContent;\n`;
  prompt += `}\n`;
  prompt += `\`\`\`\n`;

  return prompt;
}

// ─── Quick Test (server-side fetch viability) ─────────────────

export async function testServerFetch(url: string): Promise<{
  success: boolean;
  htmlLength: number;
  hasContent: boolean;
  isCloudflareBlocked: boolean;
  error?: string;
  responseTime: number;
}> {
  const start = Date.now();
  try {
    const html = await fetchHtml(url);
    const responseTime = Date.now() - start;
    const $ = cheerio.load(html);

    const isCloudflare =
      html.includes("cf-browser-verification") ||
      html.includes("__cf_chl") ||
      html.includes("cloudflare") && html.includes("challenge");

    const bodyText = $("body").text().trim();

    return {
      success: true,
      htmlLength: html.length,
      hasContent: bodyText.length > 200,
      isCloudflareBlocked: isCloudflare,
      responseTime,
    };
  } catch (err: any) {
    return {
      success: false,
      htmlLength: 0,
      hasContent: false,
      isCloudflareBlocked: false,
      error: err.message,
      responseTime: Date.now() - start,
    };
  }
}
