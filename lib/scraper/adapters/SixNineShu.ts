import type { SiteAdapter } from "../types";
import { extensionFetch } from "../extension-bridge";

export const SixNineShuAdapter: SiteAdapter = {
  name: "69书吧",
  group: "cn",
  urlPattern: /69shuba\.com|69shu\.me|69shu\.com/i,
  novelWaitSelector: ".booknav2, .bookname, .bookinfo, .more-btn, ul li a[href*='/txt/']",
  chapterWaitSelector: ".txtnav",
  useSequentialTab: true,

  async getNovelInfo(html, url) {
    let doc = new DOMParser().parseFromString(html, "text/html");
    let currentBase = new URL(url);

    // Extract novel details from the initial page first, as it contains full info (cover and author)
    const title = doc.querySelector("h1, .bookname h1, .bookinfo h1, .book-title")?.textContent?.trim() || "";
    const author = doc.querySelector(".booknav2 a[href*='author'], .author a, .bookinfo .author")?.textContent?.trim() || "";
    
    const coverImg = doc.querySelector(".bookimg2 img, .bookimg img, .book-cover img, .imgbox img, img[src*='p.69shuba'], img[src*='69shuba']");
    const coverImage = coverImg ? new URL(coverImg.getAttribute("src") || "", currentBase).href : undefined;

    // If we are on the book info page (.htm), we need to go to the chapter list page to get chapter links
    const isBookInfoPage = url.endsWith(".htm") || url.includes("/book/");
    const isChapterListPage = url.endsWith("/") && !url.includes("/txt/");

    if (!isChapterListPage) {
      // Find the "Mục lục đầy đủ" link
      const moreBtn = doc.querySelector("a.more-btn");
      if (moreBtn) {
        const indexUrl = new URL(moreBtn.getAttribute("href") || "", currentBase).href;
        const res = await extensionFetch(indexUrl);
        doc = new DOMParser().parseFromString(res.html, "text/html");
        currentBase = new URL(indexUrl);
      } else if (isBookInfoPage) {
        // Fallback: Try to derive index URL by removing .htm and ensuring trailing slash
        // https://www.69shuba.com/book/90442.htm -> https://www.69shuba.com/book/90442/
        const derivedUrl = url.replace(/\.htm$/, "") + "/";
        try {
          const res = await extensionFetch(derivedUrl);
          if (res && res.html) {
            doc = new DOMParser().parseFromString(res.html, "text/html");
            currentBase = new URL(derivedUrl);
          }
        } catch (e) {
          console.warn("Failed to fetch derived 69shu index URL", e);
        }
      }
    }

    // Chapters are in <ul><li><a> - use a Map to deduplicate by URL
    const chapterLinks = doc.querySelectorAll("ul li a[href*='/txt/']");
    const seenUrls = new Set<string>();
    const chapters: any[] = [];
    
    Array.from(chapterLinks).forEach((a) => {
      const absUrl = new URL(a.getAttribute("href") || "", currentBase).href;
      if (seenUrls.has(absUrl)) return;
      seenUrls.add(absUrl);
      
      chapters.push({
        title: a.textContent?.trim() || `Chương ${chapters.length + 1}`,
        url: absUrl,
        order: chapters.length,
      });
    });

    // Reverse chapter list if it is in descending order (highest chapter number first)
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
    const chapterTitle = doc.querySelector("h1")?.textContent?.trim() || "";

    let text = contentText || "";
    if (!text) {
      const contentEl = doc.querySelector(".txtnav");
      if (contentEl) {
        const clone = contentEl.cloneNode(true) as HTMLElement;
        
        // Remove navigation, info, ads, scripts
        clone.querySelectorAll("h1, .txtinfo, #txtright, .contentadv, script, style, .bottom-ad").forEach((el) => el.remove());
        
        // Replace <br> with newlines
        clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        
        text = clone.textContent || "";
      }
    }

    // Clean up
    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/69书吧/g, "")
      .replace(/www\.69shuba\.com/g, "")
      .replace(/www\.69shu\.me/g, "")
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
