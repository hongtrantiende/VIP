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
    "nthanhnam@gmail.com"
  ];
  return adminEmails.includes(email.toLowerCase());
}

/**
 * Tải lên một file nén Uint8Array theo dạng chunk để tránh lỗi timeout/503.
 * Mỗi chunk được gửi tuần tự kèm theo cơ chế retry nếu gặp lỗi mạng tạm thời.
 */
export async function uploadCompressedInChunks(
  novelId: string,
  metadata: any,
  compressedBytes: Uint8Array,
  onProgress?: (percent: number) => void,
  chunkSize = 1024 * 1024 // 1MB mặc định
): Promise<void> {
  const finalChunkSize = Math.ceil(chunkSize / (256 * 1024)) * (256 * 1024);
  const totalSize = compressedBytes.length;

  console.log(`Bắt đầu tải lên novel ${novelId} bằng chunk. Tổng dung lượng: ${totalSize} bytes, chunk size: ${finalChunkSize}`);

  // 1. Khởi tạo phiên tải lên Resumable (nhận sessionUrl)
  let sessionUrl = '';
  try {
    const initRes = await fetch(`/api/reading-room?action=init_upload&novelId=${novelId}&totalSize=${totalSize}`, {
      method: 'POST'
    });
    if (!initRes.ok) {
      const errJson = await initRes.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${initRes.status}`);
    }
    const data = await initRes.json();
    sessionUrl = data.sessionUrl;
  } catch (err: any) {
    throw new Error(`Khởi tạo tải lên thất bại: ${err.message}`);
  }

  const totalChunks = Math.ceil(totalSize / finalChunkSize);

  // 2. Tải lên tất cả các chunk tuần tự sử dụng sessionUrl
  for (let i = 0; i < totalChunks; i++) {
    const start = i * finalChunkSize;
    const end = Math.min(start + finalChunkSize, totalSize);
    const chunkSlice = compressedBytes.subarray(start, end);
    const contentRange = `bytes ${start}-${end - 1}/${totalSize}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'x-session-url': sessionUrl,
      'content-range': contentRange
    };

    let success = false;
    let errorMsg = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = `/api/reading-room?action=upload_chunk&chunkIndex=${i}`;
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: new Blob([chunkSlice as any]),
        });

        if (res.ok) {
          const resJson = await res.json().catch(() => ({}));
          if (resJson.success && (resJson.status === 308 || resJson.status === 200 || resJson.status === 201)) {
            success = true;
            break;
          } else {
            errorMsg = resJson.error || `Google Drive status ${resJson.status}: ${resJson.responseText}`;
          }
        } else {
          const errJson = await res.json().catch(() => ({}));
          errorMsg = errJson.error || `HTTP Error ${res.status}`;
          const transientStatusCodes = [429, 500, 502, 503, 504];
          if (!transientStatusCodes.includes(res.status)) {
            break; // Lỗi nghiêm trọng không cần thử lại
          }
        }
      } catch (err: any) {
        errorMsg = err.message || 'Lỗi kết nối';
      }

      if (attempt < 3) {
        console.warn(`Lần tải lên chunk ${i + 1}/${totalChunks} thất bại (Lần ${attempt}). Thử lại sau ${Math.pow(2, attempt)}s...`);
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    if (!success) {
      console.error(`Tải lên chunk ${i + 1}/${totalChunks} thất bại vĩnh viễn: ${errorMsg}`);
      throw new Error(`Lỗi tải lên chunk ${i + 1}/${totalChunks}: ${errorMsg}`);
    }

    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 95));
    }
  }

  // 3. Gửi yêu cầu hoàn tất tải lên (Finalize) kèm theo metadata, sessionUrl và totalSize
  console.log(`Đang gửi yêu cầu hoàn tất tải lên cho novel ${novelId}`);
  let finalizeSuccess = false;
  let finalizeErrorMsg = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url = `/api/reading-room?action=finalize_upload&novelId=${novelId}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ metadata, sessionUrl, totalSize }),
      });

      if (res.ok) {
        finalizeSuccess = true;
        break;
      } else {
        const errJson = await res.json().catch(() => ({}));
        finalizeErrorMsg = errJson.error || `HTTP Error ${res.status}`;
        const transientStatusCodes = [429, 500, 502, 503, 504];
        if (!transientStatusCodes.includes(res.status)) {
          break; // Lỗi nghiêm trọng không cần thử lại
        }
      }
    } catch (err: any) {
      finalizeErrorMsg = err.message || 'Lỗi kết nối';
    }

    if (attempt < 3) {
      console.warn(`Yêu cầu hoàn tất tải lên thất bại (Lần ${attempt}). Thử lại sau ${Math.pow(2, attempt)}s...`);
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  if (!finalizeSuccess) {
    console.error(`Hoàn tất tải lên thất bại: ${finalizeErrorMsg}`);
    throw new Error(`Lỗi hoàn tất tải lên: ${finalizeErrorMsg}`);
  }

  if (onProgress) {
    onProgress(100);
  }
  console.log(`Tải lên hoàn tất thành công cho novel ${novelId}`);
}

/**
 * Sanitize a string to be a safe, clean, and readable filename
 * by removing Vietnamese diacritics and replacing non-alphanumeric characters.
 */
export function sanitizeFilename(title: string): string {
  if (!title) return "novel";
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

