import type { SiteAdapter } from "../types";

export const Po18Adapter: SiteAdapter = {
  name: "Popo / PO18",
  group: "cn",
  urlPattern: /popo\.tw|po18\.tw/,
  // Wait for the actual reading content container
  chapterWaitSelector: ".read-txt, .article-content, .b_content",
  // Click the "I am 18+" button if it appears
  chapterClickSelector: "a.yes",

  async getNovelInfo(html, url, onProgress) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const title = doc.querySelector("h1.book_name, h1")?.textContent?.trim() || "Unknown Title";
    const author = doc.querySelector(".book_author, .author, a[href*='/author/']")?.textContent?.trim() || "Unknown Author";
    const coverImage = doc.querySelector(".book_cover img, img.book_cover")?.getAttribute("src") || undefined;
    const description = doc.querySelector(".book_intro, .book_desc, .intro")?.textContent?.trim() || "";

    const chapters: { title: string; url: string; order: number }[] = [];
    const seenUrls = new Set<string>();

    // PO18 chapter links are typically found under /books/[id]/articles/[article_id]
    const links = Array.from(doc.querySelectorAll("a[href*='/articles/']"));

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;
      
      // Skip non-reading links (like comments)
      if (href.includes("comments") || href.includes("rewards")) return;

      let titleText = link.textContent?.trim();

      // On PO18, the link to read might just say "閱讀" (Read) or "訂購" (Buy/Order)
      // The actual title is often in a sibling or parent element with class .l_chaptname
      if (!titleText || titleText.includes("閱讀") || titleText.includes("訂購") || titleText === "") {
        const row = link.closest("div, li, tr");
        if (row) {
          const nameEl = row.querySelector(".l_chaptname, .chapter_name");
          if (nameEl && nameEl.textContent) {
            titleText = nameEl.textContent.trim();
          }
        }
      }

      // If we still don't have a good title, use a generic one
      if (!titleText || titleText.includes("閱讀") || titleText.includes("訂購")) {
        titleText = `Chương ${chapters.length + 1}`;
      }

      const fullUrl = new URL(href, url).toString();
      let cleanUrl = fullUrl.split("#")[0].split("?")[0];

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
      coverImage: coverImage ? new URL(coverImage, url).toString() : undefined,
      description,
      chapters,
    };
  },

  getChapterContent(html, _url, contentText) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapterTitle = doc.querySelector("h1, h2, .l_chaptname")?.textContent?.trim() || "";

    // PO18 content is inside .read-txt
    // Remove watermark blockquotes: <blockquote class="copyright">
    const contentNode = doc.querySelector(".read-txt, .article-content, #article_content, .b_content, #b_content");

    let rawText = "";
    if (contentNode) {
      // Remove copyright watermarks and junk
      const junkSelectors = ["script", "style", "iframe", ".watermark", ".hidden", "blockquote.copyright", "blockquote[cite]"];
      junkSelectors.forEach(sel => {
        contentNode.querySelectorAll(sel).forEach(el => el.remove());
      });

      // Extract text from remaining <p> and <font> tags
      const clone = contentNode.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      clone.querySelectorAll("p").forEach((p) => {
        // Get the deepest text, ignoring nested <font> tags
        const text = p.textContent?.trim() || "";
        if (text) {
          p.replaceWith("\n" + text + "\n");
        } else {
          p.remove();
        }
      });
      
      rawText = (clone.textContent || "")
        .replace(/\u00a0/g, " ")  // Replace &nbsp;
        .replace(/ {2,}/g, " ")   // Collapse multiple spaces
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => !/^[A-Za-z0-9]{30,}$/.test(line)) // Remove any remaining hash watermarks
        .join("\n\n");
    }

    // Fallback to contentText from extension
    if (!rawText && contentText) {
      rawText = contentText
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => !/^[A-Za-z0-9]{30,}$/.test(line))
        .join("\n\n");
    }

    // Find Next Chapter URL
    let nextChapterUrl = "";
    const nextLinks = Array.from(doc.querySelectorAll("a[href]"));
    for (const link of nextLinks) {
      const text = link.textContent?.trim() || "";
      if (text.includes("下一章") || text.includes("下一頁") || text.includes("下一篇") || text.includes("next")) {
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
