import type { SiteAdapter } from "../types";

export const HeTuShuAdapter: SiteAdapter = {
  name: "和图书",
  group: "cn",
  urlPattern: /hetushu\.com/i,
  novelWaitSelector: "h2, h1, a[href*='/book/']",
  // Only wait for content elements — h1/h2 would extract only the title text as contentText
  chapterWaitSelector: "#content, .content",
  useSequentialTab: true,

  async getNovelInfo(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const currentBase = new URL(url);

    const title = doc.querySelector("h2, h1, .book-title, .title")?.textContent?.trim() || "Unknown Title";
    
    // Attempt to extract author
    let author = doc.querySelector(".author, a[href*='author'], a[class='0']")?.textContent?.trim() || "";
    if (!author) {
      const authorMatch = html.match(/(tác giả|author|作者):\s*([^|\n<]+)/i);
      if (authorMatch) {
        author = authorMatch[2].trim();
      }
    }

    // Attempt to extract cover
    const coverImg = doc.querySelector(".book_info img, .cover img, .book-cover img, img[src*='cover'], img[src*='hetushu']");
    const coverSrc = coverImg ? (coverImg.getAttribute("data-src") || coverImg.getAttribute("data-original") || coverImg.getAttribute("src") || "") : "";
    // Use direct URL — browser already has Cloudflare cookies from visiting the site,
    // so <img> tags can load hetushu images directly without server-side proxy.
    const coverImage = coverSrc 
      ? new URL(coverSrc, currentBase).toString()
      : undefined;

    // Chapters are links that match /book/ID/XXXX.html
    const bookIdMatch = url.match(/\/book\/(\d+)/);
    const bookId = bookIdMatch ? bookIdMatch[1] : "";
    
    const chapterLinks = doc.querySelectorAll("a[href]");
    const seenUrls = new Set<string>();
    const chapters: any[] = [];
    
    Array.from(chapterLinks).forEach((a) => {
      const href = a.getAttribute("href") || "";
      const absUrl = new URL(href, currentBase).href;
      if (seenUrls.has(absUrl)) return;
      
      const isChapterUrl = absUrl.includes(`/book/${bookId}/`) && absUrl.endsWith(".html") && !absUrl.endsWith("index.html");
      if (!isChapterUrl) return;
      
      seenUrls.add(absUrl);
      chapters.push({
        title: a.textContent?.trim() || `Chương ${chapters.length + 1}`,
        url: absUrl,
        order: chapters.length,
      });
    });

    // Deduplicate and clean up chapter order
    if (chapters.length >= 2) {
      const order1 = parseInt(chapters[0].title.match(/\d+/)?.[0] || '1', 10);
      const order2 = parseInt(chapters[chapters.length - 1].title.match(/\d+/)?.[0] || '999', 10);
      if (order1 > order2) {
        chapters.reverse();
        chapters.forEach((c, idx) => c.order = idx);
      }
    }

    return { title, author, chapters, coverImage };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let chapterTitle = "";
    const titleElements = doc.querySelectorAll("h1, h2, .chapter-title");
    if (titleElements.length > 1) {
      const titles = Array.from(titleElements).map(el => el.textContent?.trim() || "");
      const actualTitle = titles.find(t => t.match(/第[一二三四五六七八九十百千万\d]+[章回节]/));
      chapterTitle = actualTitle || titles[1] || titles[0];
    } else {
      chapterTitle = titleElements[0]?.textContent?.trim() || "";
    }

    let text = contentText || "";
    if (!text) {
      const contentEl = doc.querySelector("#content, .content, #chapter-content");
      if (contentEl) {
        const clone = contentEl.cloneNode(true) as HTMLElement;
        
        // Remove navigation, script, ads
        clone.querySelectorAll("h1, h2, script, style, .ads, .advertisement").forEach((el) => el.remove());
        
        // Replace br with newline
        clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        
        text = clone.textContent || "";
      }
    }

    // Clean up preface/introduction (lời mở đầu) as requested by the user.
    // If the text contains the chapter title/marker like "第一章", slice the text from there.
    // The pattern targets chapter markers like 章, 回, 节 and ignores volume markers like 卷.
    const chapterMatch = text.match(/(?:^|\n)(第[一二三四五六七八九十百千万\d]+[章回节])/);
    if (chapterMatch && chapterMatch.index !== undefined) {
      text = text.substring(chapterMatch.index).trim();
      // Strip the chapter title line from content — hetushu.com repeats "第X章 Title" as the
      // first line of #content, so it shows up as a repeated first line across all chapters.
      // This line is already captured in `chapterTitle`, so we remove it from the body.
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) {
        const firstLine = text.substring(0, firstNewline).trim();
        if (firstLine.match(/^第[一二三四五六七八九十百千万\d]+[章回节]/)) {
          text = text.substring(firstNewline + 1).trim();
        }
      }
    }

    // Basic cleaning
    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/和图书/g, "")
      .replace(/hetushu\.com/g, "")
      .replace(/www\.hetushu\.com/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    let nextChapterUrl: string | undefined = undefined;
    const nextLink = Array.from(doc.querySelectorAll("a")).find(a => 
      a.textContent?.includes("下一章") || 
      a.textContent?.includes("Sau") || 
      a.textContent?.includes("Next")
    );
    if (nextLink) {
      nextChapterUrl = new URL(nextLink.getAttribute("href") || "", _url).href;
    }

    return { title: chapterTitle, content: text, nextChapterUrl };
  },
};
