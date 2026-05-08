// ─── Site Adapter ──────────────────────────────────────────

export interface SiteAdapter {
  /** Display name, e.g. "Sáng Tác Việt" */
  name: string;
  /** Site group: "cn" for Chinese sites, "vn" for Vietnamese sites */
  group?: "cn" | "vn";
  /** Regex to auto-detect adapter from URL */
  urlPattern: RegExp;
  /** CSS selector to wait for before extracting chapter HTML (AJAX content) */
  chapterWaitSelector?: string;
  /** CSS selector to click after page load to trigger content loading */
  chapterClickSelector?: string;
  /** Minimum delay (in ms) per chapter fetch. Defaults to 7000ms if not specified. */
  minDelayMs?: number;
  /** If true, the extension will reuse a single background tab and update its URL instead of opening/closing tabs. */
  useSequentialTab?: boolean;
  /** Parse novel page HTML → novel info + chapter list */
  getNovelInfo(html: string, url: string, onProgress?: (count: number) => void): NovelInfo | Promise<NovelInfo>;
  /** Parse chapter page HTML → chapter content. contentText is innerText from live DOM (bypasses font obfuscation). */
  getChapterContent(html: string, url: string, contentText?: string): ChapterContent | Promise<ChapterContent>;
}

// ─── Data Types ────────────────────────────────────────────

export interface NovelInfo {
  title: string;
  author?: string;
  description?: string;
  coverImage?: string;
  chapters: ChapterLink[];
}

export interface ChapterLink {
  title: string;
  url: string;
  order: number;
  id?: string | number;
}

export interface ChapterContent {
  title: string;
  /** Plain text content */
  content: string;
  /** Warning message if content may be incomplete */
  warning?: string;
  /** Original order index from the table of contents */
  order?: number;
  /** Link to the next chapter (for crawling/walking mode) */
  nextChapterUrl?: string;
}

export interface ScrapeProgress {
  completed: number;
  total: number;
  currentTitle: string;
}
