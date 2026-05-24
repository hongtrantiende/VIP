import { cleanGarbageLines } from "../../text-utils";
import type { SiteAdapter } from "../types";

/**
 * Adapter for stv
 *
 * Novel page structure:
 * - `bookinfo` JS variable contains novel metadata (id, host, name, namevi, thumb, author)
 * - Chapter list is rendered by JS — links have href="about:blank" with chapter title as text
 * - Chapter titles start with a number (e.g. "1 chapter title here")
 * - Chapter URL pattern: /truyen/{host}/{type}/{id}/{chapterNumber}/
 *
 * Chapter page:
 * - Content loaded via JS into #contentbox or similar container
 */
export const STVAdapter: SiteAdapter = {
  name: "STV",
  group: "vn",
  urlPattern: /sangtacviet\.\w+/,
  // #book_name2 is always in the static HTML (unlike .listchapitem which requires AJAX)
  novelWaitSelector: "#book_name2, h1.cap",
  chapterWaitSelector: "#content-container .contentbox",
  chapterClickSelector: "#content-container .contentbox",

  getNovelInfo(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Extract bookinfo from <script> tag
    const bookinfo = extractBookInfo(html);

    // Title: from bookinfo.namevi or <title> tag
    const title =
      bookinfo?.namevi?.trim() ||
      doc
        .querySelector("title")
        ?.textContent?.replace(/ - \d+ chương$/, "")
        .trim() ||
      "";

    const author = bookinfo?.author ?? undefined;
    const coverImage = bookinfo?.thumb ?? undefined;

    // Description from og:description meta — strip HTML tags
    const rawDesc =
      doc
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content")
        ?.trim() ?? undefined;
    const description = rawDesc
      ? new DOMParser()
          .parseFromString(rawDesc, "text/html")
          .body.textContent?.trim() || undefined
      : undefined;

    // Extract chapter list.
    // Priority 1: DOM-rendered .listchapitem (only available when JS has executed)
    // Priority 2: Synthetic generation from chapter count in <title> (works on static HTML)
    const baseUrl = extractBaseUrl(url);
    const allLinks = doc.querySelectorAll("a.listchapitem");

    let chapters: { title: string; url: string; order: number; id?: string }[];

    if (allLinks.length > 0) {
      // JS rendered the list — use real titles
      chapters = [...allLinks].map((el, i) => ({
        title: el.textContent?.trim() ?? `Chương ${i + 1}`,
        url: `${baseUrl}${i + 1}/`,
        order: i,
        id: bookinfo?.id,
      }));
    } else {
      // Static HTML fallback: extract chapter count from <title>
      // Format: "Novel Name - N chương"
      const titleText = doc.querySelector("title")?.textContent?.trim() ?? "";
      const countMatch = titleText.match(/[-–]\s*(\d+)\s*chương/i);
      const chapterCount = countMatch ? parseInt(countMatch[1], 10) : 0;

      if (chapterCount > 0) {
        chapters = Array.from({ length: chapterCount }, (_, i) => ({
          title: `Chương ${i + 1}`,
          url: `${baseUrl}${i + 1}/`,
          order: i,
          id: bookinfo?.id,
        }));
      } else {
        chapters = [];
      }
    }

    return { title, author, description, coverImage, chapters };
  },

  getChapterContent(html, _url, contentText) {
    const chapterTitle =
      extractChapterTitle(html) ??
      new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("title")
        ?.textContent?.trim() ??
      "";

    // Prefer contentText (innerText from live DOM — bypasses CSS font obfuscation)
    const rawText = contentText ?? "";
    if (!rawText) return { title: chapterTitle, content: "" };

    const junkText = "Bạn đang xem văn bản gốc chưa dịch, có thể kéo xuống cuối trang để chọn bản dịch.";
    let text = rawText
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("@Bạn đang đọc") && 
          trimmed !== junkText
        );
      })
      .join("\n");
      
    text = cleanGarbageLines(text);

    return { title: chapterTitle, content: text };
  },
};

// ─── Helpers ───────────────────────────────────────────────

interface BookInfo {
  id?: string;
  host?: string;
  name?: string;
  namevi?: string;
  thumb?: string;
  author?: string;
  lastupdate?: string;
}

/** Extract chapter title from page <title> — format: "chapterTitle - novelTitle - siteName" */
function extractChapterTitle(html: string): string | null {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  if (!match) return null;
  const full = match[1].trim();
  // Split by " - " and take first part (chapter title)
  const parts = full.split(/\s+-\s+/);
  return parts[0]?.trim() || null;
}

function parseLooseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    const obj: any = {};
    // Match unquoted/quoted keys and their string/number values
    const matches = str.matchAll(/(?:\s*['"]?([\w\-]+)['"]?\s*:\s*['"]?([^'",}]+)['"]?\s*)/g);
    for (const m of matches) {
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.substring(1, val.length - 1);
      }
      obj[key] = val;
    }
    return Object.keys(obj).length > 0 ? obj : null;
  }
}

function extractBookInfo(html: string): BookInfo | null {
  // Match: var bookinfo = {...}; (supporting multiline and ending with semicolon)
  const match = html.match(/var\s+bookinfo\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;
  return parseLooseJson(match[1]);
}

/**
 * Extract base URL for chapter construction.
 * (ensures trailing slash)
 */
function extractBaseUrl(url: string): string {
  const u = url.endsWith("/") ? url : url + "/";
  return u;
}
