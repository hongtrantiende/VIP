import type { SiteAdapter } from "../types";

export const JjwxcAdapter: SiteAdapter = {
  name: "JJWXC (晋江文学城)",
  group: "cn",
  urlPattern: /jjwxc\.net/i,
  novelWaitSelector: "tr[itemprop='chapter'], #novelintro",
  chapterWaitSelector: "body",

  async getNovelInfo(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const currentBase = new URL(url);

    const titleEl = doc.querySelector("h1[itemprop='name'] span[itemprop='articleSection']") || doc.querySelector("h1[itemprop='name']");
    const title = titleEl?.textContent?.trim() || "";

    const authorEl = doc.querySelector("h2 span[itemprop='author']");
    const author = authorEl?.textContent?.trim() || "";

    const coverImg = doc.querySelector("img.noveldefaultimage, .novelimg img, img[itemprop='image']");
    const coverImage = coverImg ? new URL(coverImg.getAttribute("src") || coverImg.getAttribute("_src") || "", currentBase).href : undefined;

    const descEl = doc.querySelector("#novelintro[itemprop='description'], #novelintro");
    let description = descEl?.innerHTML || "";
    if (description) {
      // Clean up description (replace <br> with newlines)
      const tempDiv = doc.createElement("div");
      tempDiv.innerHTML = description.replace(/<br\s*\/?>/gi, "\n");
      description = tempDiv.textContent?.trim() || "";
    }

    const chapters: any[] = [];
    const chapterEls = doc.querySelectorAll('tr[itemprop="chapter"] td a[itemprop="url"]');
    
    chapterEls.forEach((a) => {
      const href = a.getAttribute("href") || a.getAttribute("rel");
      if (!href) return;
      
      const absUrl = new URL(href, currentBase).href;
      chapters.push({
        title: a.textContent?.trim() || `Chương ${chapters.length + 1}`,
        url: absUrl,
        order: chapters.length,
      });
    });

    return { title, author, chapters, coverImage, description: description || undefined };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Usually JJWXC title is in h2
    const chapterTitle = doc.querySelector("h2")?.textContent?.trim() || doc.querySelector("h1")?.textContent?.trim() || "";

    // We ignore contentText because it contains the entire body (header + menus + footer)
    let text = "";
    
    // Attempt to find the specific text container
    const contentEl = doc.querySelector(".noveltext") || doc.querySelector("div[id^='chaptercontent']") || doc.querySelector(".boder");
    
    if (contentEl) {
      const clone = contentEl.cloneNode(true) as HTMLElement;
      // Clean up common garbage
      clone.querySelectorAll("div[style*='display:none'], script, style, h1, h2, hr, .readbtn, div[style*='text-align: center'], div[style*='text-align:center'], #float_favorite, #report_box, .favoriteshow").forEach((el) => el.remove());
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      text = clone.textContent || "";
    } else {
      // Fallback: use contentText but strip out everything before the chapter title and after the end markers
      text = contentText || doc.body.textContent || "";
      
      // Try to cut off the massive JJWXC header
      if (chapterTitle && text.includes(chapterTitle)) {
        const parts = text.split(chapterTitle);
        // Keep everything after the first occurrence of the title
        parts.shift();
        text = parts.join(chapterTitle);
      } else {
        // Fallback header cut if title not found
        text = text.replace(/[\s\S]*?←上一章\s*下一章→/i, "");
      }
      
      // Cut off footer
      text = text.replace(/支持手机扫描二维码阅读[\s\S]*/, "");
      text = text.replace(/打开晋江App扫码即可阅读[\s\S]*/, "");
      text = text.replace(/该作者现在暂无推文[\s\S]*/, "");
      text = text.replace(/作\s*者\s*推\s*文[\s\S]*/, "");
    }

    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/插入书签/g, "") // "Insert bookmark"
      .replace(/作者有话要说：/g, "\n\n=== Tác giả nói ===\n")
      .replace(/支持手机扫描二维码阅读[\s\S]*/, "") // Just in case
      .replace(/打开晋江App扫码即可阅读[\s\S]*/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return { title: chapterTitle, content: text };
  },
};
