import { create } from "zustand";
import { persist } from "zustand/middleware";
import { detectAdapter } from "../scraper/adapters";
import {
  sanitizeChapterContent,
  scrapeChapters,
  type ScrapeDebugEntry,
} from "../scraper/engine";
import { extensionFetch, checkExtensionStatus, extensionDownloadSTVChapter } from "../scraper/extension-bridge";
import { novelIndexDebugSummary } from "../scraper/novel-page-diagnostics";
import { db } from "../db";
import { stripHtml, countWords } from "../utils";
import { toast } from "sonner";
import type {
  ChapterContent,
  ChapterLink,
  NovelInfo,
  SiteAdapter,
} from "../scraper/types";

export type ScraperStep = "url" | "select" | "stv-wait" | "scraping" | "preview";

export interface DebugLog {
  timestamp: string;
  label: string;
  data: string;
}

interface ScraperState {
  step: ScraperStep;
  url: string;
  adapter: SiteAdapter | null;
  extensionAvailable: boolean | null;
  extensionVersion: string | null;
  novelInfo: NovelInfo | null;
  selectedChapterUrls: Set<string>;
  scrapedChapters: ChapterContent[];
  progress: { completed: number; total: number; current: string };
  isLoading: boolean;
  error: string | null;
  abortController: AbortController | null;
  retryingIndex: number | null;
  debugLogs: DebugLog[];
  chapterDelay: number;
  isPaused: boolean;
  targetNovelId: string | null;

  // Actions
  setUrl: (url: string) => void;
  setAdapter: (adapter: SiteAdapter | null) => void;
  checkExtension: () => Promise<void>;
  fetchNovelInfo: () => Promise<void>;
  toggleChapter: (url: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  startScraping: () => Promise<void>;
  confirmSTVReady: () => Promise<void>;
  startCrawling: (targetNovelId?: string) => Promise<void>;
  retryScrapeChapter: (index: number) => Promise<void>;
  abortScraping: () => void;
  pauseScraping: () => void;
  resumeScraping: () => void;
  scanForErrors: () => void;
  setStep: (step: ScraperStep) => void;
  setChapterDelay: (delay: number) => void;
  reset: () => void;
  clearDebugLogs: () => void;
}

const initialState = {
  step: "url" as ScraperStep,
  url: "",
  adapter: null as SiteAdapter | null,
  extensionAvailable: null as boolean | null,
  extensionVersion: null as string | null,
  novelInfo: null as NovelInfo | null,
  selectedChapterUrls: new Set<string>(),
  scrapedChapters: [] as ChapterContent[],
  progress: { completed: 0, total: 0, current: "" },
  isLoading: false,
  error: null as string | null,
  abortController: null as AbortController | null,
  retryingIndex: null as number | null,
  debugLogs: [] as DebugLog[],
  chapterDelay: 0.5,
  isPaused: false,
  targetNovelId: null as string | null,
};

function addLog(label: string, data: unknown) {
  const log: DebugLog = {
    timestamp: new Date().toLocaleTimeString(),
    label,
    data: typeof data === "string" ? data : JSON.stringify(data, null, 2),
  };
  const prev = useScraperStore.getState().debugLogs;
  useScraperStore.setState({ debugLogs: [...prev, log] });
}

function logChapterIssue(entry: ScrapeDebugEntry) {
  const issue =
    entry.timedOut ||
    !!entry.parsed.warning ||
    entry.parsed.content.length < 100;
  if (!issue) return;

  addLog("Scrape · chapter issue", {
    title: entry.chapterTitle,
    url: entry.url,
    len: entry.parsed.content.length,
    htmlLen: entry.htmlLength,
    timedOut: entry.timedOut,
    ctLen: entry.contentTextLength,
    warning: entry.parsed.warning ?? null,
    wait: entry.waitSelector ?? null,
    click: entry.clickSelector ?? null,
  });
  if (entry.extensionLogs?.length) {
    const tail = entry.extensionLogs.slice(-4).join(" | ");
    addLog("Scrape · chapter · ext tail", tail);
  }
}

export const useScraperStore = create<ScraperState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setUrl: (url: string) => {
        const adapter = detectAdapter(url);
        const current = get().adapter;
        set({ url, adapter: adapter ?? current, error: null });
      },

      setAdapter: (adapter: SiteAdapter | null) => {
        set({ adapter });
      },

      checkExtension: async () => {
        const { available, version } = await checkExtensionStatus();
        set({ extensionAvailable: available, extensionVersion: version });
      },

      fetchNovelInfo: async () => {
        let { url, adapter } = get();
        
        // Re-detect adapter if it's null (e.g. after page reload)
        if (!adapter && url) {
          adapter = detectAdapter(url);
          set({ adapter });
        }

        if (!adapter) {
          set({ error: "Không tìm thấy adapter cho URL này" });
          return;
        }

        set({ isLoading: true, error: null, debugLogs: [] });
        try {
          const { html, timedOut } = await extensionFetch(url);
          const novelInfo = await adapter.getNovelInfo(html, url);

          addLog("Scrape · index", {
            ok: true,
            url,
            adapter: adapter.name,
            title: novelInfo.title,
            chapters: novelInfo.chapters.length,
            cover: Boolean(novelInfo.coverImage),
            htmlLen: html.length,
            timedOut: timedOut ?? false,
          });

          if (novelInfo.chapters.length === 0) {
            addLog("Scrape · index · no chapters", {
              url,
              adapter: adapter.name,
              title: novelInfo.title,
              probe: novelIndexDebugSummary(html, url),
            });
            set({ error: "Không tìm thấy chương nào", isLoading: false });
            return;
          }

          const selectedChapterUrls = new Set(
            novelInfo.chapters.map((ch: ChapterLink) => ch.url),
          );

          set({
            novelInfo,
            selectedChapterUrls,
            isLoading: false,
            step: "select",
          });
        } catch (err) {
          addLog("Scrape · index · error", err instanceof Error ? err.message : String(err));
          set({
            error:
              err instanceof Error ? err.message : "Lỗi khi lấy thông tin truyện",
            isLoading: false,
          });
        }
      },

      toggleChapter: (url: string) => {
        const selected = new Set(get().selectedChapterUrls);
        if (selected.has(url)) selected.delete(url);
        else selected.add(url);
        set({ selectedChapterUrls: selected });
      },

      selectAll: () => {
        const chapters = get().novelInfo?.chapters ?? [];
        set({ selectedChapterUrls: new Set(chapters.map((ch: ChapterLink) => ch.url)) });
      },

      deselectAll: () => {
        set({ selectedChapterUrls: new Set() });
      },

      startScraping: async () => {
        let { novelInfo, selectedChapterUrls, adapter, url } = get();
        if (!novelInfo) return;
        
        if (!adapter) {
          adapter = detectAdapter(url);
          set({ adapter });
        }
        if (!adapter) return;

        let selectedChapters = novelInfo.chapters.filter((ch: ChapterLink) =>
          selectedChapterUrls.has(ch.url),
        );

        // Filter out duplicates if we know the novel
        const existingNovel = await db.novels.where("sourceUrl").equals(url).first();
        if (existingNovel) {
          const chaptersInDb = await db.chapters.where("novelId").equals(existingNovel.id).toArray();
          const existingTitles = new Set(chaptersInDb.map(c => c.title.toLowerCase().trim()));
          const initialCount = selectedChapters.length;
          selectedChapters = selectedChapters.filter((ch: any) => !existingTitles.has(ch.title.toLowerCase().trim()));
          const skipped = initialCount - selectedChapters.length;
          if (skipped > 0) {
            addLog("Scrape · Duplicates", `Bỏ qua ${skipped} chương đã có trong thư viện.`);
            toast.info(`Đã tự động bỏ qua ${skipped} chương đã tồn tại trong thư viện.`);
          }
        }

        if (selectedChapters.length === 0) {
          if (novelInfo.chapters.some((ch: any) => selectedChapterUrls.has(ch.url))) {
             toast.success("Tất cả các chương đã chọn đều đã có trong thư viện.");
          }
          return;
        }

        if (adapter.name === "STV") {
          set({ step: "stv-wait", error: null });
          return;
        }

        const abortController = new AbortController();
        set({
          step: "scraping",
          isLoading: true,
          error: null,
          scrapedChapters: [],
          progress: { completed: 0, total: selectedChapters.length, current: "" },
          abortController,
        });

        try {
          await scrapeChapters(
            selectedChapters,
            adapter,
            (completed, total, currentTitle) => {
              set({ progress: { completed, total, current: currentTitle } });
            },
            abortController.signal,
            (entry) => {
              const prev = get().scrapedChapters;
              set({ scrapedChapters: [...prev, entry.parsed] });
              logChapterIssue(entry);
            },
            get().chapterDelay * 1000,
            () => get().isPaused
          );

          set({
            isLoading: false,
            step: "preview",
            abortController: null,
          });
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            set({ isLoading: false, error: "Đã hủy scraping", abortController: null });
            return;
          }
          addLog("Scrape · batch · error", err instanceof Error ? err.message : String(err));
          set({
            error: err instanceof Error ? err.message : "Lỗi khi scrape",
            isLoading: false,
            abortController: null,
          });
        }
      },

      confirmSTVReady: async () => {
        let { novelInfo, selectedChapterUrls, adapter, url, scrapedChapters } = get();
        if (!novelInfo) return;

        if (!adapter) {
          adapter = detectAdapter(url);
          set({ adapter });
        }
        if (!adapter) return;

        const allSelected = novelInfo.chapters.filter((ch: ChapterLink) =>
          selectedChapterUrls.has(ch.url),
        );
        
        // Resume from where we left off
        // Note: scrapedChapters contains successfully parsed chapters from previous run
        const pendingChapters = allSelected.slice(scrapedChapters.length);
        
        if (pendingChapters.length === 0) {
          set({ step: "preview" });
          return;
        }

        const abortController = new AbortController();
        set({
          step: "scraping",
          isLoading: true,
          error: null,
          // DO NOT clear scrapedChapters here, we are resuming
          progress: { completed: scrapedChapters.length, total: allSelected.length, current: "" },
          abortController,
        });

        try {
          await scrapeChapters(
            pendingChapters,
            adapter,
            (completed, total, currentTitle) => {
              // total here is pendingChapters.length
              // We want to show progress relative to allSelected
              const overallCompleted = scrapedChapters.length + completed;
              set({ progress: { completed: overallCompleted, total: allSelected.length, current: currentTitle } });
            },
            abortController.signal,
            (entry) => {
              const prev = get().scrapedChapters;
              set({ scrapedChapters: [...prev, entry.parsed] });
              logChapterIssue(entry);
            },
            get().chapterDelay * 1000,
            () => get().isPaused
          );

          set({
            isLoading: false,
            step: "preview",
            abortController: null,
          });
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            set({ isLoading: false, error: "Đã hủy scraping", abortController: null });
            return;
          }
          set({
            error: err instanceof Error ? err.message : "Lỗi khi scrape",
            isLoading: false,
            abortController: null,
          });
        }
      },

      startCrawling: async (novelId?: string) => {
        let { url, adapter } = get();
        if (!adapter) {
          adapter = detectAdapter(url);
          set({ adapter });
        }
        if (!adapter) return;

        const abortController = new AbortController();
        set({
          step: "scraping",
          isLoading: true,
          error: null,
          scrapedChapters: [],
          progress: { completed: 0, total: 0, current: "" },
          abortController,
          targetNovelId: novelId || null,
        });

        try {
          const { crawlNovel } = await import("../scraper/engine");
          
          await crawlNovel(
            url,
            adapter,
            async (content, currentUrl) => {
              const state = get();
              let targetId = state.targetNovelId;
              const now = new Date();

              // Create novel if it doesn't exist
              if (!targetId) {
                targetId = crypto.randomUUID();
                await db.novels.add({
                  id: targetId,
                  title: content.title.split(":")[0]?.trim() || "Truyện Crawl",
                  description: "",
                  sourceUrl: url,
                  createdAt: now,
                  updatedAt: now,
                });
                set({ targetNovelId: targetId });
              }

              // Add chapter
              const chapterId = crypto.randomUUID();
              const plainText = stripHtml(content.content);
              const currentOrder = await db.chapters.where("novelId").equals(targetId).count();

              await db.chapters.add({
                id: chapterId,
                novelId: targetId,
                title: content.title,
                originalTitle: content.title,
                order: currentOrder,
                createdAt: now,
                updatedAt: now,
              });

              await db.scenes.add({
                id: crypto.randomUUID(),
                chapterId,
                novelId: targetId,
                title: content.title,
                content: content.content,
                order: 0,
                wordCount: countWords(plainText),
                version: 0,
                versionType: "manual",
                isActive: 1,
                createdAt: now,
                updatedAt: now,
              });

              set({ scrapedChapters: [...get().scrapedChapters, content] });
            },
            (completed, currentTitle) => {
              set({ progress: { completed, total: 0, current: currentTitle } });
            },
            abortController.signal,
            get().chapterDelay * 1000,
            () => get().isPaused
          );

          set({ isLoading: false, step: "preview", abortController: null });
          toast.success("Đã hoàn thành crawl truyện!");
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            set({ isLoading: false, error: "Đã hủy crawling", abortController: null });
            return;
          }
          set({
            error: err instanceof Error ? err.message : "Lỗi khi crawl",
            isLoading: false,
            abortController: null,
          });
        }
      },

      scanForErrors: () => {
        const { scrapedChapters } = get();
        const updated = scrapedChapters.map((ch: ChapterContent) => {
          const plain = stripHtml(ch.content).trim();
          if (plain.length < 30) {
            return { ...ch, warning: `Chương này có vẻ bị trống hoặc load lỗi (${plain.length} ký tự)` };
          }
          return ch;
        });
        set({ scrapedChapters: updated });
      },

      retryScrapeChapter: async (index: number) => {
        let { novelInfo, scrapedChapters, adapter, url } = get();
        if (!novelInfo) return;

        if (!adapter) {
          adapter = detectAdapter(url);
          set({ adapter });
        }
        if (!adapter) return;

        const selectedUrls = get().selectedChapterUrls;
        const selectedChapters = novelInfo.chapters.filter((ch: ChapterLink) => selectedUrls.has(ch.url));
        const chapterLink = selectedChapters[index];
        if (!chapterLink) return;

        set({ retryingIndex: index });
        try {
          let html = "";
          let contentText: string | undefined = undefined;
          let timedOut = false;
          let logs: string[] = [];

          let extTitle: string | undefined = undefined;
          if (adapter.name === "STV" && chapterLink.id) {
            try {
              const res = await extensionDownloadSTVChapter(chapterLink.id, chapterLink.url);
              html = res.data ?? "";
              contentText = (res as any).contentText ?? res.content ?? undefined;
              timedOut = (res as any).timedOut ?? false;
              extTitle = res.title;
            } catch (err: any) {
              timedOut = true;
              logs.push(err.message);
            }
          } else {
            const fetchRes = await extensionFetch(chapterLink.url, {
              waitSelector: adapter.chapterWaitSelector,
              clickSelector: adapter.chapterClickSelector,
            });
            html = fetchRes.html;
            contentText = fetchRes.contentText;
            timedOut = fetchRes.timedOut ?? false;
            logs = fetchRes.logs ?? [];
          }

          const content = sanitizeChapterContent(
            adapter.getChapterContent(html, chapterLink.url, contentText),
          );
          content.order = chapterLink.order;

          if (!content.title || content.title.trim() === "") {
            content.title = extTitle || chapterLink.title;
          }

          if (timedOut) {
            content.warning = `Timeout — nội dung chưa load được (${content.content.length} ký tự)`;
          } else if (content.content.length < 30) {
            content.warning = `Nội dung quá ngắn (${content.content.length} ký tự) — có thể chưa load được`;
          }
          const updated = [...scrapedChapters];
          updated[index] = content;
          set({ scrapedChapters: updated, retryingIndex: null });

          logChapterIssue({
            chapterTitle: chapterLink.title,
            url: chapterLink.url,
            htmlLength: html.length,
            parsed: content,
            extensionLogs: logs,
            timedOut: timedOut ?? false,
            contentTextLength: contentText?.length ?? 0,
            waitSelector: adapter.chapterWaitSelector,
            clickSelector: adapter.chapterClickSelector,
          });
        } catch (err) {
          set({ retryingIndex: null });
          addLog("Scrape · retry · error", err instanceof Error ? err.message : String(err));
        }
      },

      abortScraping: () => {
        get().abortController?.abort();
        set({ isBackground: false, targetNovelId: null, isPaused: false });
      },

      pauseScraping: () => set({ isPaused: true }),

      resumeScraping: () => set({ isPaused: false }),

      setStep: (step: ScraperStep) => set({ step }),

      setChapterDelay: (delay: number) => set({ chapterDelay: delay }),

      reset: () => set({ ...initialState, debugLogs: [] }),

      clearDebugLogs: () => set({ debugLogs: [] }),
    }),
    {
      name: "novel-studio:scraper-store",
      partialize: (state: any) => ({
        ...state,
        selectedChapterUrls: Array.from(state.selectedChapterUrls || []),
        abortController: null,
        isLoading: false,
        retryingIndex: null,
        adapter: null, // Don't persist adapter as it contains functions
      }),
      onRehydrateStorage: () => (state: any) => {
        if (state) {
          if (Array.isArray(state.selectedChapterUrls)) {
            state.selectedChapterUrls = new Set(state.selectedChapterUrls);
          }
          // Re-detect adapter on rehydration because functions were stripped
          if (state.url) {
            state.adapter = detectAdapter(state.url);
          } else {
            state.adapter = null;
          }
        }
      },
    }
  )
);
