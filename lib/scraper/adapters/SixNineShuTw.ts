import type { SiteAdapter } from "../types";
import { extensionFetch } from "../extension-bridge";

export const SixNineShuTwAdapter: SiteAdapter = {
  name: "69书吧 (TW)",
  group: "cn",
  urlPattern: /69shuba\.tw/i,
  novelWaitSelector: ".booknav2, .bookname, .bookinfo, .more-btn, ul li a[href*='/txt/'], ul li a[href*='/read/']",
  chapterWaitSelector: ".txtnav, .nr_nr, #nr1",
  useSequentialTab: true,

  async getNovelInfo(html, url, onProgress) {
    let doc = new DOMParser().parseFromString(html, "text/html");
    let currentBase = new URL(url);

    // Get basic info from the current page (book info page or first index page)
    const title = doc.querySelector("h1, .bookname h1, .book-title, .bookinfo h1")?.textContent?.trim() || "";
    const author = doc.querySelector(".booknav2 a[href*='author'], .author a, .bookinfo .author")?.textContent?.trim() || "";
    const coverImg = doc.querySelector(".bookimg2 img, .bookimg img, .book-cover img, .imgbox img, img[src*='p.69shuba'], img[src*='69shuba']");
    const coverImage = coverImg ? new URL(coverImg.getAttribute("src") || "", currentBase).href : undefined;

    // Determine the first index page URL
    let indexUrl = url;
    const indexLink = doc.querySelector("a.more-btn, a[href^='/indexlist/']");
    if (indexLink && !url.includes("/indexlist/")) {
      indexUrl = new URL(indexLink.getAttribute("href") || "", currentBase).href;
    } else if (url.endsWith(".htm")) {
      indexUrl = url.replace(/\.htm$/, "") + "/";
    }

    if (indexUrl !== url) {
      try {
        const res = await extensionFetch(indexUrl);
        doc = new DOMParser().parseFromString(res.html, "text/html");
        currentBase = new URL(indexUrl);
      } catch (e) {
        console.warn("Failed to fetch 69shu tw index URL", e);
      }
    }

    // Now we are on the first index page.
    const chapters: any[] = [];
    const seenUrls = new Set<string>();

    const extractChaptersFromDoc = (d: Document, base: URL) => {
      // 69shuba.tw uses TWO types of chapter elements:
      // 1. Normal: <a href="/read/..."> for most chapters
      // 2. Protected: <span class="protected-chapter-link" data-cid-url="/read/..."> for some chapters (e.g. ch.2, ch.95)
      // We must collect BOTH types and sort by DOM order to preserve correct sequence.
      const items: { url: string; title: string; liEl: Element }[] = [];

      // Collect <a href> type
      const anchorLinks = d.querySelectorAll("ul li a[href*='/txt/'], ul li a[href*='/read/']");
      anchorLinks.forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (!href) return;
        const absUrl = new URL(href, base).href;
        const li = a.closest("li");
        if (li) items.push({ url: absUrl, title: a.textContent?.trim() || "", liEl: li });
      });

      // Collect <span class="protected-chapter-link" data-cid-url="..."> type
      const protectedSpans = d.querySelectorAll("span.protected-chapter-link[data-cid-url]");
      protectedSpans.forEach((span) => {
        const cidUrl = span.getAttribute("data-cid-url") || "";
        if (!cidUrl) return;
        const absUrl = new URL(cidUrl, base).href;
        const li = span.closest("li");
        if (li) items.push({ url: absUrl, title: span.textContent?.trim() || "", liEl: li });
      });

      // Sort by DOM order to maintain correct chapter sequence
      const allLiElements = Array.from(d.querySelectorAll("ul li"));
      items.sort((a, b) => allLiElements.indexOf(a.liEl) - allLiElements.indexOf(b.liEl));

      // Add to chapters list, deduplicating by URL
      items.forEach(({ url, title }) => {
        if (seenUrls.has(url)) return;
        seenUrls.add(url);
        chapters.push({
          title: title || `Chương ${chapters.length + 1}`,
          url,
          order: chapters.length,
        });
      });
    };

    extractChaptersFromDoc(doc, currentBase);
    onProgress?.(chapters.length);

    // Check if there is pagination (e.g., 69shuba.tw indexlist)
    const selectOptions = doc.querySelectorAll("select[name='indexselect'] option, select#indexselect-top option, select.select option, .page select option");
    if (selectOptions.length > 1) {
      for (let i = 0; i < selectOptions.length; i++) {
        const opt = selectOptions[i] as HTMLOptionElement;
        const pageUrl = new URL(opt.getAttribute("value") || "", currentBase).href;
        if (pageUrl !== currentBase.href) {
          try {
            const res = await extensionFetch(pageUrl);
            const pageDoc = new DOMParser().parseFromString(res.html, "text/html");
            extractChaptersFromDoc(pageDoc, new URL(pageUrl));
            onProgress?.(chapters.length);
          } catch (e) {
            console.warn("Failed to fetch paginated index", pageUrl, e);
          }
        }
      }
    }

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

    let text = "";
    const contentEl = doc.querySelector(".txtnav") || doc.querySelector("#nr1") || doc.querySelector(".nr_nr");
    
    if (contentEl) {
      const clone = contentEl.cloneNode(true) as HTMLElement;
      
      // Remove navigation, info, ads, scripts
      clone.querySelectorAll("h1, .txtinfo, #txtright, .contentadv, script, style, .bottom-ad, .reader-ad, .ad").forEach((el) => el.remove());
      
      // Replace <br> and <p> with newlines
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      clone.querySelectorAll("p").forEach((p) => p.insertAdjacentText("afterend", "\n\n"));
      
      text = clone.textContent || "";
    } else {
      text = contentText || "";
    }

    // Clean up
    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/69书吧/g, "")
      .replace(/69shuba/ig, "")
      .replace(/www\.69shuba\.tw/g, "")
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
