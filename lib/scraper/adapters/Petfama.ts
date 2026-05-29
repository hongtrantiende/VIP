import type { SiteAdapter } from "../types";

export const PetfamaAdapter: SiteAdapter = {
  name: "Petfama / 腐看天地",
  group: "cn",
  urlPattern: /petfama\.com/i,
  chapterWaitSelector: ".novelcontent",
  novelWaitSelector: "#chapterlist li",

  async getNovelInfo(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Extract Title
    let title = "Unknown Title";
    const ogTitle = doc.querySelector("meta[property='og:title']")?.getAttribute("content");
    if (ogTitle) {
      title = ogTitle.split(",最新")[0].split(" - ")[0].trim();
    } else {
      const titleEl = doc.querySelector(".book_info h1, .title, h1");
      if (titleEl) {
        title = titleEl.textContent?.trim() || title;
      } else {
        const titleTag = doc.querySelector("title")?.textContent || "";
        title = titleTag.split("-")[0]?.trim() || title;
      }
    }
    title = title.replace(/【|】|《|》/g, "").trim();

    // Extract Author
    let author = "Unknown Author";
    const authorRegex = /(tác giả|author|tac gia|作者):\s*([^|\n<]+)/i;
    const authorMatch = html.match(authorRegex);
    if (authorMatch) {
      author = authorMatch[2].trim();
    } else {
      author = doc.querySelector(".author, .tac-gia, a[href*='author']")?.textContent?.trim() || author;
    }

    // Extract Cover
    let coverImage = doc.querySelector("meta[property='og:image']")?.getAttribute("content") || undefined;
    if (!coverImage) {
      coverImage = doc.querySelector("img[src*='cover'], img[src*='thumb'], img[class*='book']")?.getAttribute("src") || undefined;
    }

    // Extract Description
    const description = doc.querySelector(".book_intro, .book_desc, .intro, meta[name='description']")?.getAttribute("content") 
      || doc.querySelector(".book_intro, .book_desc, .intro")?.textContent?.trim() 
      || "";

    // Extract Chapters
    const chapters: { title: string; url: string; order: number }[] = [];
    const seenUrls = new Set<string>();

    const container = doc.querySelector("#chapterlist, .chapterlist");
    const links = container 
      ? Array.from(container.querySelectorAll("a[href*='/book/chapter/']"))
      : Array.from(doc.querySelectorAll("a[href*='/book/chapter/']")); // fallback

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      const fullUrl = new URL(href, url).toString();
      
      // Smart title extraction: Use <em> tag text if present (e.g. "第1章")
      // otherwise fallback to regex cleaning on entire link text
      const emEl = link.querySelector("em");
      let text = emEl ? emEl.textContent?.trim() || "" : "";
      
      if (!text) {
        text = link.textContent?.replace(/\s+/g, " ").trim() || "";
        text = text.replace(/^\d+\s+/, "").replace(/\s+免费$/, "").trim();
      }

      if (!text) {
        text = `Chương ${chapters.length + 1}`;
      }

      // Filter out garbage navigation or tab links if they somehow slip in
      if (/繼續閱讀|最新|熱門|目錄/i.test(text)) return;

      if (!seenUrls.has(fullUrl)) {
        chapters.push({
          title: text,
          url: fullUrl,
          order: chapters.length,
        });
        seenUrls.add(fullUrl);
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

    // 1. Extract Chapter Title
    let title = "";
    const titleTag = doc.querySelector("title")?.textContent || "";
    const parts = titleTag.split("-");
    if (parts.length > 1) {
      title = parts[parts.length - 1].trim();
    } else {
      const h2El = doc.querySelector("h2");
      if (h2El) {
        title = h2El.textContent?.replace(/《.*?》/g, "").trim() || "";
      }
    }

    if (!title) {
      const titleEl = doc.querySelector("h1, h2, .chapter-title, .chap-title");
      if (titleEl) {
        title = titleEl.textContent?.trim() || "";
      }
    }
    // Clean up generic site suffix if present
    title = title.replace("免費後續看→", "").trim();

    // 2. Decode Font Obfuscation (CSS Icon Mapping)
    const iconMap = new Map<string, string>();
    const styleRegex = /\.icon-([a-zA-Z0-9_-]+)\s*(?::before|::after)?\s*\{\s*content:\s*["'](\\?[a-fA-F0-9]+|[^"']+)["'];?\s*\}/gi;
    let match;
    while ((match = styleRegex.exec(html)) !== null) {
      const iconId = match[1];
      const contentVal = match[2];
      let char = "";
      if (contentVal.startsWith("\\")) {
        const hex = contentVal.slice(1);
        try {
          char = String.fromCodePoint(parseInt(hex, 16));
        } catch (e) {
          char = "";
        }
      } else {
        char = contentVal;
      }
      if (char) {
        iconMap.set(`icon-${iconId}`, char);
      }
    }

    // 3. Replace icon tags with decoded characters in live DOM
    const iconTags = Array.from(doc.querySelectorAll("i[class*='icon-']"));
    iconTags.forEach((iTag) => {
      const classAttr = iTag.getAttribute("class") || "";
      const classes = classAttr.split(/\s+/);
      let char = "";
      for (const cls of classes) {
        if (iconMap.has(cls)) {
          char = iconMap.get(cls) || "";
          break;
        }
      }
      if (char) {
        iTag.replaceWith(doc.createTextNode(char));
      } else {
        iTag.remove();
      }
    });

    // 4. Extract clean chapter paragraphs
    const contentNode = doc.querySelector(".novelcontent");
    let content = "";
    if (contentNode) {
      // Remove scripts, styles, iframe, and geniee wrapper/ads
      contentNode.querySelectorAll("script, style, iframe, .ads, .advertisement, div[data-cptid]").forEach(el => el.remove());
      
      const paragraphs = Array.from(contentNode.querySelectorAll("p"));
      if (paragraphs.length > 0) {
        content = paragraphs
          .map(p => p.textContent?.trim() || "")
          .filter(text => text.length > 0)
          .join("\n\n");
      } else {
        content = contentNode.textContent?.trim() || "";
      }
    }

    // Fallback to raw contentText if domestic extraction failed completely
    if (!content && contentText) {
      content = contentText
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join("\n\n");
    }

    // Clean structural advertising or text indicators at the end
    content = content
      .split("\n\n")
      .filter(line => !/渣男\|現代\|現實情感|言情.*字/i.test(line))
      .filter(line => !/window\.gnshbrequest/i.test(line))
      .join("\n\n");

    return {
      title,
      content,
    };
  },
};
