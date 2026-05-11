import { SiteAdapter, NovelInfo, ChapterContent } from "../types";
// @ts-ignore
import * as opentype from "opentype.js";
import { ZHIHU_PUA_DICT } from "./ZhihuPuaDict";

function getPathHash(glyph: any): string {
  if (!glyph.path || !glyph.path.commands) return "";
  return glyph.path.commands
    .map((cmd: any) => {
      let s = cmd.type;
      if (cmd.x1 !== undefined) s += Math.round(cmd.x1);
      if (cmd.y1 !== undefined) s += Math.round(cmd.y1);
      if (cmd.x2 !== undefined) s += Math.round(cmd.x2);
      if (cmd.y2 !== undefined) s += Math.round(cmd.y2);
      if (cmd.x !== undefined) s += Math.round(cmd.x);
      if (cmd.y !== undefined) s += Math.round(cmd.y);
      return s;
    })
    .join("");
}

function b64ToArrayBuffer(base64: string): ArrayBuffer {
  // Use universal atob (works in browser and Node.js >= 16)
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}
export const ZhihuAdapter: SiteAdapter = {
  name: "Zhihu (Text)",
  urlPattern: /zhihu\.com\/(question|p|market\/paid_column)\//,

  async getNovelInfo(html: string, url: string): Promise<NovelInfo> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Lấy tiêu đề bài viết
    let title = "Zhihu Story";
    const titleEl = doc.querySelector("h1.QuestionHeader-title, h1.Post-Title, .ManuscriptTitle, .SectionTitle, .Title");
    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim();
    } else {
      const docTitle = doc.querySelector("title");
      if (docTitle && docTitle.textContent) {
        title = docTitle.textContent.replace("- 知乎", "").trim();
      }
    }

    // Lấy tên tác giả (nếu có)
    let author = "Zhihu User";
    const authorEl = doc.querySelector(".AuthorInfo-name .UserLink-link, .AuthorInfo-name");
    if (authorEl && authorEl.textContent) {
      author = authorEl.textContent.trim();
    }

    return {
      title: title,
      author: author,
      description: "Truyện ngắn Zhihu tải về dưới dạng text. URL: " + url,
      coverImage: "https://pic4.zhimg.com/v2-8dcb480eec920b7a950153835694cbf3_xl.jpg", // Zhihu logo placeholder
      chapters: [
        {
          title: "Toàn bộ bài viết",
          url: url,
          order: 0,
        }
      ],
    };
  },

  async getChapterContent(html: string): Promise<ChapterContent> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // 1. Font Decryption
    let fontMap = new Map<string, string>();
    const fontMatch = html.match(/base64,(AAEAAAA[A-Za-z0-9+/=]+|d09GRg[A-Za-z0-9+/=]+)/);
    if (fontMatch) {
      try {
        const b64 = fontMatch[1];
        const buffer = b64ToArrayBuffer(b64);
        const font = opentype.parse(buffer);
        const glyphs = font.glyphs.glyphs;
        for (const key in glyphs) {
          const glyph = (glyphs as any)[key];
          if (glyph.unicode) {
            const pathHash = getPathHash(glyph);
            const realChar = ZHIHU_PUA_DICT[pathHash];
            if (realChar) {
              fontMap.set(String.fromCodePoint(glyph.unicode), realChar);
            }
          }
        }
      } catch (e) {
        console.error("Zhihu font parsing error:", e);
      }
    }

    // Nội dung chính thường nằm trong .RichText
    const contentEl = doc.querySelector(".RichText.ztext, .Post-RichText, .ManuscriptItem-content, .Section-content, .Post-RichTextContainer");
    
    let textContent = "";

    let targetEl = contentEl;

    if (!targetEl) {
      // Fallback: Tìm thẻ div có nhiều thẻ p nhất
      const allDivs = doc.querySelectorAll("div");
      let maxPCount = 0;
      let bestDiv: Element | null = null;
      for (const div of Array.from(allDivs)) {
        const pCount = div.querySelectorAll("p").length;
        if (pCount > maxPCount) {
          maxPCount = pCount;
          bestDiv = div;
        }
      }
      if (bestDiv && maxPCount > 0) {
        targetEl = bestDiv;
      }
    }

    if (targetEl) {
      // Create a clone to avoid mutating the document
      const clone = targetEl.cloneNode(true) as Element;
      
      // Replace <br> with newlines
      const brs = clone.querySelectorAll("br");
      brs.forEach(br => br.replaceWith("\n"));

      // Replace </p> and </div> with newlines
      const blocks = clone.querySelectorAll("p, div");
      blocks.forEach(block => {
        block.appendChild(doc.createTextNode("\n\n"));
      });

      textContent = clone.textContent?.trim() || "Nội dung rỗng";
      // Normalize multiple newlines
      textContent = textContent.replace(/\n{3,}/g, "\n\n");
    } else {
      return { content: "Không tìm thấy nội dung bài viết Zhihu.", title: "Toàn bộ bài viết" };
    }

    if (fontMap.size > 0 && textContent) {
      let decryptedText = "";
      for (const char of textContent) {
        decryptedText += fontMap.get(char) || char;
      }
      textContent = decryptedText;
    }

    return {
      title: "Toàn bộ bài viết",
      content: textContent.trim(),
    };
  },
};
