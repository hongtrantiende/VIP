import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db } from "../db";
import { detectAdapter } from "../scraper/adapters";
import { scrapeChapters, serverScrapeChapters } from "../scraper/engine";
import { stripHtml, countWords } from "../utils";
import type { ChapterLink, SiteAdapter } from "../scraper/types";
import { toast } from "sonner";
import { checkAndIncrementUsage } from "../usage-limits";
import { checkIsVipStandalone } from "../hooks/use-profile";

import { createCustomAdapter, type CustomScraperConfig } from "../scraper/adapters/Universal";

/** Minimal server-side adapter placeholder */
const SERVER_ADAPTER: SiteAdapter = {
  name: "Server",
  urlPattern: /.*/,
  getNovelInfo: () => ({ title: "", chapters: [] }),
  getChapterContent: (html: string) => ({ title: "", content: html }),
};

export interface ScraperJob {
  id: string; // novelId
  title: string;
  url: string;
  coverImage?: string;
  adapter: SiteAdapter;
  customConfig?: CustomScraperConfig;
  chaptersToScrape: ChapterLink[];
  progress: { completed: number; total: number; current: string };
  status: "pending" | "scraping" | "paused" | "done" | "error";
  error?: string;
  warnCount: number;
  delayMs: number;
  abortController: AbortController | null;
  createdAt: Date;
}

interface ScraperQueueState {
  jobs: Record<string, ScraperJob>;
  isOverlayMinimized: boolean;
  fetchingInfo: { visible: boolean; url: string; count: number };

  setFetchingInfo: (info: { visible: boolean; url: string; count: number }) => void;
  addJob: (
    novelId: string,
    title: string,
    url: string,
    chapters: ChapterLink[],
    delayMs: number,
    coverImage?: string,
    adapterName?: string,
    customConfig?: CustomScraperConfig
  ) => void;
  removeJob: (id: string) => void;
  pauseJob: (id: string) => void;
  resumeJob: (id: string) => void;
  skipChapterJob: (id: string) => void;
  cancelJob: (id: string) => void;
  clearDone: () => void;
  updateJobTitle: (id: string, newTitle: string) => void;
  setMinimized: (min: boolean) => void;
  processQueue: () => Promise<void>;
  restoreJobFromDB: (novelId: string, title: string, url: string, coverImage?: string) => Promise<void>;
}

const MAX_CONCURRENCY = 999;

export const useScraperQueueStore = create<ScraperQueueState>()(
  persist(
    (set, get) => ({
      jobs: {},
      isOverlayMinimized: false,
      fetchingInfo: { visible: false, url: "", count: 0 },

      setFetchingInfo: (info) => set({ fetchingInfo: info }),
      setMinimized: (min) => set({ isOverlayMinimized: min }),

      addJob: async (novelId, title, url, chapters, delayMs, coverImage, adapterName, customConfig) => {
        // Determine the adapter to use
        let adapter;
        if (customConfig) {
          adapter = createCustomAdapter(customConfig);
        } else if (adapterName === "Server") {
          adapter = SERVER_ADAPTER;
        } else {
          adapter = detectAdapter(url) || SERVER_ADAPTER;
        }

        // Pre-scrape duplicate filtering
        const existingChapters = await db.chapters.where("novelId").equals(novelId).toArray();
        const existingOrders = new Set(existingChapters.map(c => c.order));
        const newChapters = chapters.filter(ch => !existingOrders.has(ch.order));

        if (newChapters.length === 0) {
          toast.success(`Tất cả chương của '${title}' đã có sẵn!`);
          return;
        }

        if (newChapters.length < chapters.length) {
          toast.info(`Bỏ qua ${chapters.length - newChapters.length} chương đã tồn tại.`);
        }

        const job: ScraperJob = {
          id: novelId,
          title,
          url,
          coverImage,
          adapter,
          customConfig,
          chaptersToScrape: newChapters,
          progress: { completed: existingChapters.length, total: existingChapters.length + newChapters.length, current: "Đang đợi..." },
          status: "pending",
          warnCount: 0,
          delayMs,
          abortController: new AbortController(),
          createdAt: new Date(),
        };

        set((state) => ({ jobs: { ...state.jobs, [novelId]: job } }));

        // Trigger queue processing
        get().processQueue();
      },

      restoreJobFromDB: async (novelId, title, url, coverImage) => {
        // Only restore if it doesn't exist
        if (get().jobs[novelId]) return;

        const existingChapters = await db.chapters.where("novelId").equals(novelId).toArray();
        const count = existingChapters.length;

        const adapter = detectAdapter(url) || SERVER_ADAPTER;

        const job: ScraperJob = {
          id: novelId,
          title,
          url,
          coverImage,
          adapter,
          chaptersToScrape: [],
          progress: { completed: count, total: count, current: "Đã khôi phục" },
          status: "done",
          warnCount: 0,
          delayMs: 10000,
          abortController: null,
          createdAt: new Date(),
        };

        set((state) => ({ jobs: { ...state.jobs, [novelId]: job } }));
      },

      processQueue: async () => {
        const state = get();
        const activeCount = Object.values(state.jobs).filter(j => j.status === "scraping" || j.status === "paused").length;

        if (activeCount >= MAX_CONCURRENCY) return; // Queue full

        const nextJob = Object.values(state.jobs)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .find(j => j.status === "pending");

        if (!nextJob) return; // No pending jobs

        // Mark as scraping
        set((s) => ({ jobs: { ...s.jobs, [nextJob.id]: { ...nextJob, status: "scraping" } } }));

        // Start scraping in background
        (async () => {
          try {
            const isServer = nextJob.adapter.name === "Server";

            if (isServer) {
              // Server-side scraping path (no extension needed)
              await serverScrapeChapters(
                nextJob.chaptersToScrape,
                (completed, total, currentTitle) => {
                  set((s) => {
                    const j = s.jobs[nextJob.id];
                    if (!j) return s;
                    return {
                      jobs: {
                        ...s.jobs,
                        [nextJob.id]: {
                          ...j,
                          progress: {
                            ...j.progress,
                            completed: j.progress.total - j.chaptersToScrape.length,
                            current: currentTitle,
                          },
                        },
                      },
                    };
                  });
                },
                nextJob.abortController?.signal,
                async (entry) => {
                  const isVip = await checkIsVipStandalone();
                  if (!checkAndIncrementUsage('download', 1, isVip)) {
                    get().pauseJob(nextJob.id);
                    toast.error("Hôm nay bạn đã dùng hết giới hạn 100 lượt tải chương miễn phí. Hãy nâng cấp VIP để dùng không giới hạn!");
                    return;
                  }

                  if (entry.parsed.warning) {
                    set((s) => {
                      const j = s.jobs[nextJob.id];
                      if (!j) return s;
                      return { jobs: { ...s.jobs, [nextJob.id]: { ...j, warnCount: j.warnCount + 1 } } };
                    });
                  }

                  const now = new Date();
                  const normalizedTitle = entry.parsed.title.toLowerCase().trim();

                  const existing = await db.chapters
                    .where("novelId")
                    .equals(nextJob.id)
                    .toArray()
                    .then(chs => chs.find(c => c.title.toLowerCase().trim() === normalizedTitle));

                  if (existing) {
                    const scenes = await db.scenes.where("chapterId").equals(existing.id).toArray();
                    const activeScene = scenes.find(s => s.isActive === 1);
                    if (activeScene) {
                      await db.scenes.update(activeScene.id, {
                        content: entry.parsed.content,
                        versionType: "manual",
                        wordCount: countWords(stripHtml(entry.parsed.content)),
                        updatedAt: now,
                      });
                    }
                  } else {
                    const chapterId = crypto.randomUUID();
                    const plainText = stripHtml(entry.parsed.content);
                    const currentOrder = await db.chapters.where("novelId").equals(nextJob.id).count();

                    await db.chapters.add({
                      id: chapterId,
                      novelId: nextJob.id,
                      title: entry.parsed.title,
                      originalTitle: entry.parsed.title,
                      order: entry.parsed.order ?? currentOrder,
                      createdAt: now,
                      updatedAt: now,
                    });

                    await db.scenes.add({
                      id: crypto.randomUUID(),
                      chapterId,
                      novelId: nextJob.id,
                      title: entry.parsed.title,
                      content: entry.parsed.content,
                      order: 0,
                      wordCount: countWords(plainText),
                      version: 0,
                      versionType: "manual",
                      isActive: 1,
                      createdAt: now,
                      updatedAt: now,
                    });
                  }

                  // Update remaining chapters
                  set((s) => {
                    const j = s.jobs[nextJob.id];
                    if (!j) return s;
                    return {
                      jobs: {
                        ...s.jobs,
                        [nextJob.id]: {
                          ...j,
                          chaptersToScrape: j.chaptersToScrape.slice(1),
                          progress: {
                            ...j.progress,
                            completed: j.progress.total - (j.chaptersToScrape.length - 1),
                          }
                        }
                      }
                    };
                  });
                },
                nextJob.delayMs,
                () => get().jobs[nextJob.id]?.status === "paused"
              );
            } else {
              // Extension-based scraping path (existing behavior)
              await scrapeChapters(
                nextJob.chaptersToScrape,
                nextJob.adapter,
                (completed, total, currentTitle) => {
                  set((s) => {
                    const j = s.jobs[nextJob.id];
                    if (!j) return s;
                    // Progress relative to the START of this specific run
                    // But we want to show overall progress.
                    // Since we slice chaptersToScrape as we go, 
                    // 'completed' here is always 1 for the first successful chapter in this batch.
                    // Wait, the progress in the overlay is (job.progress.completed / job.progress.total).
                    // So we should increment job.progress.completed.
                    return {
                      jobs: {
                        ...s.jobs,
                        [nextJob.id]: {
                          ...j,
                          progress: {
                            ...j.progress,
                            completed: j.progress.total - j.chaptersToScrape.length,
                            current: currentTitle
                          },
                        },
                      },
                    };
                  });
                },
                nextJob.abortController?.signal,
                async (entry) => {
                  const isVip = await checkIsVipStandalone();
                  if (!checkAndIncrementUsage('download', 1, isVip)) {
                    get().pauseJob(nextJob.id);
                    toast.error("Hôm nay bạn đã dùng hết giới hạn 100 lượt tải chương miễn phí. Hãy nâng cấp VIP để dùng không giới hạn!");
                    return;
                  }

                  // Increment warnings if needed
                  if (entry.timedOut || entry.parsed.content.length < 1 || entry.parsed.warning) {
                    set((s) => {
                      const j = s.jobs[nextJob.id];
                      if (!j) return s;
                      return { jobs: { ...s.jobs, [nextJob.id]: { ...j, warnCount: j.warnCount + 1 } } };
                    });
                  }

                  const now = new Date();
                  const normalizedTitle = entry.parsed.title.toLowerCase().trim();

                  const existing = await db.chapters
                    .where("novelId")
                    .equals(nextJob.id)
                    .toArray()
                    .then(chs => chs.find(c => c.title.toLowerCase().trim() === normalizedTitle));

                  if (existing) {
                    const scenes = await db.scenes.where("chapterId").equals(existing.id).toArray();
                    const activeScene = scenes.find(s => s.isActive === 1);
                    if (activeScene) {
                      await db.scenes.update(activeScene.id, {
                        content: entry.parsed.content,
                        versionType: "manual",
                        wordCount: countWords(stripHtml(entry.parsed.content)),
                        updatedAt: now,
                      });
                    }
                  } else {
                    const chapterId = crypto.randomUUID();
                    const plainText = stripHtml(entry.parsed.content);
                    const currentOrder = await db.chapters.where("novelId").equals(nextJob.id).count();

                    await db.chapters.add({
                      id: chapterId,
                      novelId: nextJob.id,
                      title: entry.parsed.title,
                      originalTitle: entry.parsed.title,
                      order: entry.parsed.order ?? currentOrder,
                      createdAt: now,
                      updatedAt: now,
                    });

                    await db.scenes.add({
                      id: crypto.randomUUID(),
                      chapterId,
                      novelId: nextJob.id,
                      title: entry.parsed.title,
                      content: entry.parsed.content,
                      order: 0,
                      wordCount: countWords(plainText),
                      version: 0,
                      versionType: "manual",
                      isActive: 1,
                      createdAt: now,
                      updatedAt: now,
                    });
                  }

                  // Update remaining chapters so we can resume correctly
                  set((s) => {
                    const j = s.jobs[nextJob.id];
                    if (!j) return s;
                    return {
                      jobs: {
                        ...s.jobs,
                        [nextJob.id]: {
                          ...j,
                          chaptersToScrape: j.chaptersToScrape.slice(1),
                          progress: {
                            ...j.progress,
                            completed: j.progress.total - (j.chaptersToScrape.length - 1),
                          }
                        }
                      }
                    };
                  });
                },
                nextJob.delayMs,
                () => get().jobs[nextJob.id]?.status === "paused",
                (newChapter) => {
                  set((s) => {
                    const j = s.jobs[nextJob.id];
                    if (!j) return s;
                    const updatedChapters = [...j.chaptersToScrape];
                    // Chèn chương mới ngay sau chương đang chạy để tuần tự hóa đúng
                    updatedChapters.splice(1, 0, newChapter);
                    return {
                      jobs: {
                        ...s.jobs,
                        [nextJob.id]: {
                          ...j,
                          chaptersToScrape: updatedChapters,
                          progress: {
                            ...j.progress,
                            total: j.progress.total + 1
                          }
                        }
                      }
                    };
                  });
                }
              );
            } // end isServer else

            // Done
            set((s) => {
              const j = s.jobs[nextJob.id];
              if (!j) return s;
              return { jobs: { ...s.jobs, [nextJob.id]: { ...j, status: "done" } } };
            });
            toast.success(`Đã tải xong truyện: ${nextJob.title}`);
          } catch (err: any) {
            if (err.name !== "AbortError") {
              set((s) => {
                const j = s.jobs[nextJob.id];
                if (!j) return s;
                return { jobs: { ...s.jobs, [nextJob.id]: { ...j, status: "error", error: err.message } } };
              });
              toast.error(`Lỗi tải truyện ${nextJob.title}: ${err.message}`);
            }
          } finally {
            // Continue processing queue
            get().processQueue();
          }
        })();

        // Attempt to process next job immediately (in case max concurrency isn't reached yet)
        get().processQueue();
      },

      removeJob: (id) => {
        set((state) => {
          const newJobs = { ...state.jobs };
          delete newJobs[id];
          return { jobs: newJobs };
        });
      },

      pauseJob: (id) => {
        set((state) => {
          const j = state.jobs[id];
          if (!j || j.status !== "scraping") return state;
          return { jobs: { ...state.jobs, [id]: { ...j, status: "paused" } } };
        });
      },

      resumeJob: (id) => {
        let needsProcess = false;
        set((state) => {
          const j = state.jobs[id];
          if (!j) return state;
          if (j.status === "paused") {
            if (j.abortController) {
              // Loop is still alive, just unpause it
              return { jobs: { ...state.jobs, [id]: { ...j, status: "scraping" } } };
            } else {
              // Loop is dead (reloaded), queue a new one
              needsProcess = true;
              return { jobs: { ...state.jobs, [id]: { ...j, status: "pending", abortController: new AbortController() } } };
            }
          }
          if (j.status === "error") {
            needsProcess = true;
            return { jobs: { ...state.jobs, [id]: { ...j, status: "pending", error: undefined, abortController: new AbortController() } } };
          }
          return state;
        });
        if (needsProcess) {
          get().processQueue();
        }
      },

      skipChapterJob: (id) => {
        const j = get().jobs[id];
        if (j && j.abortController) {
          j.abortController.abort();
        }

        set((state) => {
          const j = state.jobs[id];
          if (!j) return state;
          if (j.chaptersToScrape.length > 0) {
            toast.info(`Đã bỏ qua chương: ${j.chaptersToScrape[0].title}`);
            return {
              jobs: {
                ...state.jobs,
                [id]: {
                  ...j,
                  chaptersToScrape: j.chaptersToScrape.slice(1),
                  // Calculate progress correctly
                  progress: {
                    ...j.progress,
                    completed: j.progress.completed + 1 // mark skipped as completed to advance progress bar
                  },
                  status: "pending",
                  error: undefined,
                  abortController: new AbortController()
                }
              }
            };
          }
          return state;
        });
        get().processQueue();
      },

      cancelJob: (id) => {
        const j = get().jobs[id];
        if (j && j.abortController) {
          j.abortController.abort();
        }
        get().removeJob(id);
        setTimeout(() => get().processQueue(), 500);
      },

      clearDone: () => {
        set((state) => {
          const newJobs = { ...state.jobs };
          for (const [id, job] of Object.entries(newJobs)) {
            if (job.status === "done" || job.status === "error") {
              delete newJobs[id];
            }
          }
          return { jobs: newJobs };
        });
      },

      updateJobTitle: (id: string, newTitle: string) => {
        set((state) => {
          const j = state.jobs[id];
          if (!j) return state;
          return { jobs: { ...state.jobs, [id]: { ...j, title: newTitle } } };
        });
      },
    }),
    {
      name: "scraper-queue",
      partialize: (state) => {
        const jobsToSave: Record<string, any> = {};
        for (const [id, job] of Object.entries(state.jobs)) {
          // Serialize without non-serializable fields
          jobsToSave[id] = {
            ...job,
            adapter: undefined,
            abortController: undefined,
          };
        }
        return { jobs: jobsToSave } as any;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          const rehydratedJobs: Record<string, ScraperJob> = {};
          for (const [id, job] of Object.entries(state.jobs as Record<string, any>)) {
            const adapter = job.customConfig ? createCustomAdapter(job.customConfig) : (detectAdapter(job.url) || (job.adapter?.name === "Server" ? SERVER_ADAPTER : null));
            if (!adapter) continue; // Skip if adapter is missing or invalid

            rehydratedJobs[id] = {
              ...job,
              adapter,
              abortController: undefined,
              createdAt: new Date(job.createdAt),
              // Auto-pause any job that was running
              status: job.status === "scraping" ? "paused" : job.status,
            };
          }
          state.jobs = rehydratedJobs;
        }
      },
    }
  )
);
