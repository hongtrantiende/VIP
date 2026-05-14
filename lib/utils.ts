import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  const latin = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (cjk?.length ?? 0) + latin.length;
}

/**
 * Kiểm tra xem văn bản có chứa chủ yếu là tiếng Trung hay không.
 * Ngăn chặn việc người dùng ném nguyên một cục tiếng Việt vào để train.
 */
export function isMostlyChinese(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  
  // Lọc bỏ khoảng trắng và dấu câu
  const cleanText = text.replace(/[\s\p{P}]/gu, '');
  if (cleanText.length === 0) return false;

  const chineseChars = cleanText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  const chineseCount = chineseChars ? chineseChars.length : 0;
  
  // Nếu tỷ lệ ký tự tiếng Trung / tổng số ký tự (sau khi bỏ dấu) >= 15%, thì coi là hợp lệ
  // 15% là mức an toàn cho các đoạn hội thoại có nhiều tên riêng/từ mượn Latin,
  // nhưng đủ để chặn một đoạn văn bản thuần Việt 100%.
  return (chineseCount / cleanText.length) >= 0.15;
}

export function stripHtml(html: string): string {
  if (typeof window === "undefined") return html.replace(/<[^>]+>/g, "");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}


/** Convert basic markdown to HTML (bold, italic, links, inline code) */
export function markdownToHtml(md: string): string {
  return md
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, text: string, url: string) => {
        if (/^https?:\/\//.test(url)) {
          return `<a href="${url}" class="underline font-medium hover:opacity-80" target="_blank" rel="noopener noreferrer">${text}</a>`;
        }
        if (/^\/[^/]/.test(url) || url.startsWith("#")) {
          return `<a href="${url}" class="underline font-medium hover:opacity-80">${text}</a>`;
        }
        return text;
      },
    )
    .replace(/\n/g, "<br />");
}

/**
 * Strips all HTML tags, decodes basic HTML entities, and extracts text content from HTML or Markdown.
 * Handles: tags, common entities, line breaks, inline code, emphasis, links, and basic markdown syntax.
 * @param preserveLineBreaks When true, keeps paragraph breaks (e.g. scraped chapter body); when false, one compact line (titles, UI).
 */
export function sanitizeText(text: string, preserveLineBreaks = false): string {
  if (!text) return "";
  let output = text;

  output = output.replace(/<br\s*\/?>/gi, preserveLineBreaks ? "\n" : " ");
  output = output.replace(
    /<\/(p|div|li|h\d|tr|section|article|ul|ol|table|center|blockquote|pre)>/gi,
    "\n",
  );
  output = output.replace(/<[^>]+>/g, "");
  output = output
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/");
  output = output
    .replace(/[*_]{2}([^*_]+)[*_]{2}/g, "$1")
    .replace(/[*_]([^*_]+)[*_]/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

  output = output.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  if (preserveLineBreaks) {
    output = output
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
    output = output.replace(/\n{3,}/g, "\n\n");
    output = output.replace(/[ \t]+/g, " ");
    output = output.replace(/ *\n */g, "\n");
    return output.trim();
  }

  output = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  output = output.replace(/\s+/g, " ").trim();

  return output;
}

export function isHex(v: string) {
  return /^#([0-9a-fA-F]{3,8})$/.test(v);
}

export function isLocalhost(): boolean {
  if (typeof window === "undefined") return process.env.NODE_ENV === "development";
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.startsWith("192.168.")
  );
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const adminEmails = [
    "nthanhnam2005@gmail.com",
    "thanhxnam2005@gmail.com"
  ];
  return adminEmails.includes(email.toLowerCase());
}
