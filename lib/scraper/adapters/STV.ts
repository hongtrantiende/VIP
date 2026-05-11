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
  novelWaitSelector: "a.listchapitem",
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

    // Extract chapter list by class — all chapter links have class "listchapitem"
    // URL uses 1-based sequential DOM position (not the number in the title)
    const baseUrl = extractBaseUrl(url);
    const allLinks = doc.querySelectorAll("a.listchapitem");
    const chapters = [...allLinks].map((el, i) => ({
      title: el.textContent?.trim() ?? `Chương ${i + 1}`,
      url: `${baseUrl}${i + 1}/`,
      order: i,
      id: bookinfo?.id,
    }));

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

function extractBookInfo(html: string): BookInfo | null {
  // Match: var bookinfo = {...};
  const match = html.match(/var\s+bookinfo\s*=\s*(\{[^}]+\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Extract base URL for chapter construction.
 * (ensures trailing slash)
 */
function extractBaseUrl(url: string): string {
  const u = url.endsWith("/") ? url : url + "/";
  return u;
}
