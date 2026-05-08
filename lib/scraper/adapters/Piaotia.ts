import type { SiteAdapter } from "../types";
import { extensionFetch } from "../extension-bridge";

export const PiaotiaAdapter: SiteAdapter = {
  name: "飘天文学",
  group: "cn",
  urlPattern: /piaotia\.com/i,
  chapterWaitSelector: "#content",

  async getNovelInfo(html, url) {
    let doc = new DOMParser().parseFromString(html, "text/html");
    let currentBase = new URL(url);

    const isIndexPage = url.includes("/html/") && url.endsWith("/index.html");
    
    if (!isIndexPage) {
      // Try to find the link to the chapter list using various selectors
      let indexLink = doc.querySelector("a[href*='/html/'][href$='/index.html'], a[href='index.html'], a[href='./index.html']");
      
      // Fallback: search by common link text
      if (!indexLink) {
        const anchors = Array.from(doc.querySelectorAll("a"));
        indexLink = anchors.find(a => {
          const text = a.textContent?.trim() || "";
          return text.includes("查看全部章节") || 
                 text.includes("点击阅读") || 
                 text.includes("返回书目") || 
                 text.includes("返回章节");
        }) || null;
      }

      if (indexLink) {
        const indexUrl = new URL(indexLink.getAttribute("href") || "", currentBase).href;
        const res = await extensionFetch(indexUrl);
        doc = new DOMParser().parseFromString(res.html, "text/html");
        currentBase = new URL(indexUrl);
      } else {
        // Pattern-based fallback if no link found
        const bookInfoMatch = url.match(/\/bookinfo\/(\d+)\/(\d+)\.html/i);
        const chapterMatch = url.match(/\/html\/(\d+)\/(\d+)\/(\d+)\.html/i);
        
        let indexUrl = "";
        if (bookInfoMatch) {
          indexUrl = `https://www.piaotia.com/html/${bookInfoMatch[1]}/${bookInfoMatch[2]}/index.html`;
        } else if (chapterMatch) {
          indexUrl = `https://www.piaotia.com/html/${chapterMatch[1]}/${chapterMatch[2]}/index.html`;
        }

        if (indexUrl) {
          try {
            const res = await extensionFetch(indexUrl);
            if (res && res.html) {
              doc = new DOMParser().parseFromString(res.html, "text/html");
              currentBase = new URL(indexUrl);
            }
          } catch (e) {
            console.warn("Failed to fetch fallback index URL:", indexUrl, e);
          }
        }
      }
    }

    const title = doc.querySelector("h1")?.textContent?.trim() || "";
    
    // Author and Description are in <td> elements with specific labels
    let author = "";
    let description = "";
    const tds = doc.querySelectorAll("td");
    tds.forEach((td) => {
      const text = td.textContent || "";
      if (text.includes("作    者：")) {
        author = text.split("：")[1]?.trim() || "";
      }
      if (text.includes("内容简介：")) {
        description = text.split("：")[1]?.trim() || "";
      }
    });

    const coverImg = doc.querySelector("img[src*='/bookimage/'], img[src*='/files/article/image/']");
    let coverImage = coverImg ? new URL(coverImg.getAttribute("src") || "", currentBase).href : undefined;

    // If no cover found, try to derive from URL
    if (!coverImage) {
      const match = url.match(/\/(?:html|bookinfo)\/(\d+)\/(\d+)(?:\/index)?\.html/i);
      if (match) {
        const [, a, b] = match;
        coverImage = `https://www.piaotia.com/files/article/image/${a}/${b}/${b}s.jpg`;
      }
    }

    // Chapters are usually in <div class="centent"> -> <ul><li><a> or <table><td><a>
    const chapterLinks = doc.querySelectorAll(".centent a[href$='.html']");
    const chapters = Array.from(chapterLinks).map((a, i) => ({
      title: a.textContent?.trim() || `Chương ${i + 1}`,
      url: new URL(a.getAttribute("href") || "", currentBase).href,
      order: i,
    }));

    return { title, author, description, coverImage, chapters };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterTitle = doc.querySelector("h1")?.textContent?.trim() || "";

    let text = "";
    const contentEl = doc.querySelector("#content");
    
    if (contentEl) {
      const clone = contentEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".toplink, script, style, table, .ads, h1").forEach((el) => el.remove());
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      text = clone.textContent || "";
    } else {
      // Piaotia often puts text directly in the body
      const clone = doc.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("div, table, script, style, h1, center, a").forEach(el => el.remove());
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      text = clone.textContent || "";
    }

    if (!text && contentText) {
      text = contentText;
    }

    // Clean up
    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/飘天文学/g, "")
      .replace(/www\.piaotia\.com/g, "")
      .replace(/【[^\]]+】/g, "") // Remove common bracketed ads
      .replace(/重要声明：小说.*/, "") // Remove footer copyright notice
      .trim();

    return { title: chapterTitle, content: text };
  },
};
