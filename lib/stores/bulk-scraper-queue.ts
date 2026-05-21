/**
 * Bulk Scraper Queue — manages continuous auto-scan + parallel download.
 * Admin-only. Scans 5 novels → downloads → when 1 done, auto-scan 1 more.
 */

import { create } from "zustand";
import type { CatalogNovel } from "../scraper/types";
import { detectAdapter } from "../scraper/adapters";
import { extensionFetch } from "../scraper/extension-bridge";
import { scrapeChapters } from "../scraper/engine";
import { db } from "../db";
import { scanSiteCatalog, detectCatalogAdapter, type CatalogScanAdapter } from "../scraper/catalog-scanner";

export type BulkJobStatus = "pending" | "fetching-info" | "scraping" | "done" | "error" | "cancelled";

export interface BulkJob {
    id: string;
    novel: CatalogNovel;
    status: BulkJobStatus;
    progress: { completed: number; total: number; current: string };
    error?: string;
    abortController: AbortController | null;
}

export type AutoScanPhase = "idle" | "running" | "paused" | "finished";

interface BulkScraperState {
    // Auto-scan state
    phase: AutoScanPhase;
    siteUrl: string;
    currentPage: number;
    siteExhausted: boolean;
    catalogAdapter: CatalogScanAdapter | null;

    // Job state
    jobs: BulkJob[];
    completedCount: number;
    failedCount: number;
    totalScanned: number;
    existingUrls: Set<string>;
    scannedUrls: Set<string>;

    // Master abort
    masterAbort: AbortController | null;

    // Actions
    startAutoScan: (siteUrl: string) => void;
    pauseAutoScan: () => void;
    resumeAutoScan: () => void;
    stopAutoScan: () => void;
    cancelJob: (id: string) => void;
    reset: () => void;
    _updateJob: (id: string, updates: Partial<BulkJob>) => void;
    _onJobFinished: (jobId: string) => void;
    _scanAndFillSlots: () => void;
}

const MAX_PARALLEL = 5;
const NOVELS_PER_SCAN = 5;

export const useBulkScraperStore = create<BulkScraperState>((set, get) => ({
    phase: "idle",
    siteUrl: "",
    currentPage: 1,
    siteExhausted: false,
    catalogAdapter: null,
    jobs: [],
    completedCount: 0,
    failedCount: 0,
    totalScanned: 0,
    existingUrls: new Set(),
    scannedUrls: new Set(),
    masterAbort: null,

    startAutoScan: async (siteUrl) => {
        const adapter = detectCatalogAdapter(siteUrl);
        if (!adapter) return;

        // Load existing novels from IDB
        const novels = await db.novels.toArray();
        const existingUrls = new Set(
            novels.map((n) => n.sourceUrl).filter(Boolean) as string[]
        );

        const ac = new AbortController();

        set({
            phase: "running",
            siteUrl,
            currentPage: 1,
            siteExhausted: false,
            catalogAdapter: adapter,
            jobs: [],
            completedCount: 0,
            failedCount: 0,
            totalScanned: 0,
            existingUrls,
            scannedUrls: new Set(),
            masterAbort: ac,
        });

        // Start scanning and filling slots
        get()._scanAndFillSlots();
    },

    pauseAutoScan: () => set({ phase: "paused" }),
    resumeAutoScan: () => {
        set({ phase: "running" });
        get()._scanAndFillSlots();
    },

    stopAutoScan: () => {
        const { jobs, masterAbort } = get();
        masterAbort?.abort();
        for (const job of jobs) {
            if (["pending", "fetching-info", "scraping"].includes(job.status)) {
                job.abortController?.abort();
            }
        }
        set({ phase: "idle" });
    },

    cancelJob: (id) => {
        const job = get().jobs.find((j) => j.id === id);
        if (job?.abortController) job.abortController.abort();
        get()._updateJob(id, { status: "cancelled" });
    },

    reset: () =>
        set({
            phase: "idle",
            siteUrl: "",
            currentPage: 1,
            siteExhausted: false,
            catalogAdapter: null,
            jobs: [],
            completedCount: 0,
            failedCount: 0,
            totalScanned: 0,
            existingUrls: new Set(),
            scannedUrls: new Set(),
            masterAbort: null,
        }),

    _updateJob: (id, updates) => {
        set((state) => ({
            jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
        }));
    },

    _onJobFinished: (jobId) => {
        const { phase } = get();
        if (phase === "running") {
            // Fill the empty slot
            setTimeout(() => get()._scanAndFillSlots(), 500);
        }
    },

    _scanAndFillSlots: async () => {
        const state = get();
        if (state.phase !== "running") return;

        const activeCount = state.jobs.filter(
            (j) => ["pending", "fetching-info", "scraping"].includes(j.status)
        ).length;

        const slotsAvailable = MAX_PARALLEL - activeCount;
        if (slotsAvailable <= 0) return;

        if (state.siteExhausted) {
            // No more novels to scan
            if (activeCount === 0) {
                set({ phase: "finished" });
            }
            return;
        }

        const { catalogAdapter, siteUrl, currentPage, existingUrls, scannedUrls } = state;
        if (!catalogAdapter) return;

        // Scan pages until we have enough new novels
        let newNovels: CatalogNovel[] = [];
        let page = currentPage;
        let exhausted = false;

        while (newNovels.length < slotsAvailable && !exhausted) {
            if (get().phase !== "running") return;

            try {
                const results = await scanSiteCatalog(siteUrl, catalogAdapter, {
                    startPage: page,
                    maxPages: 1,
                    existingUrls,
                });

                if (results.length === 0) {
                    exhausted = true;
                    break;
                }

                for (const novel of results) {
                    if (!scannedUrls.has(novel.url) && !existingUrls.has(novel.url)) {
                        newNovels.push(novel);
                        scannedUrls.add(novel.url);
                    }
                }

                page++;
            } catch (err) {
                console.error(`[BulkScan] Page ${page} failed:`, err);
                page++;
                // Skip failed pages
            }
        }

        set({
            currentPage: page,
            siteExhausted: exhausted,
            totalScanned: scannedUrls.size,
        });

        if (newNovels.length === 0 && exhausted) {
            const activeCount = get().jobs.filter(
                (j) => ["pending", "fetching-info", "scraping"].includes(j.status)
            ).length;
            if (activeCount === 0) set({ phase: "finished" });
            return;
        }

        // Create jobs for new novels
        const newJobs: BulkJob[] = newNovels.slice(0, slotsAvailable).map((novel, i) => ({
            id: `bulk-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
            novel,
            status: "pending" as BulkJobStatus,
            progress: { completed: 0, total: 0, current: "" },
            abortController: null,
        }));

        set((s) => ({ jobs: [...s.jobs, ...newJobs] }));

        // Start processing each job
        for (const job of newJobs) {
            processJob(job.id, get, set);
        }
    },
}));

/** Process a single novel job: fetch info → scrape chapters → save to IDB */
async function processJob(
    jobId: string,
    get: () => BulkScraperState,
    set: (fn: (s: BulkScraperState) => Partial<BulkScraperState>) => void,
) {
    const update = (updates: Partial<BulkJob>) => {
        get()._updateJob(jobId, updates);
    };

    const ac = new AbortController();
    update({ status: "fetching-info", abortController: ac });

    try {
        const job = get().jobs.find((j) => j.id === jobId);
        if (!job) return;

        const novelUrl = job.novel.url;

        // 1. Detect adapter
        const adapter = detectAdapter(novelUrl);
        if (!adapter) throw new Error(`Không tìm thấy adapter cho: ${novelUrl}`);

        // 2. Fetch novel page to get chapter list
        const { html } = await extensionFetch(novelUrl, {
            waitSelector: adapter.novelWaitSelector,
        });

        ac.signal.throwIfAborted();

        const novelInfo = await adapter.getNovelInfo(html, novelUrl, (count) => {
            update({ progress: { completed: 0, total: count, current: `Đang quét ${count} chương...` } });
        });

        if (novelInfo.chapters.length === 0) throw new Error("Không tìm thấy chương nào");

        // 3. Create novel in IDB
        const novelId = `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await db.novels.put({
            id: novelId,
            title: novelInfo.title || job.novel.title,
            author: novelInfo.author || job.novel.author || "",
            coverImage: novelInfo.coverImage || job.novel.coverImage || "",
            description: novelInfo.description || "",
            sourceUrl: novelUrl,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Add to existing URLs so future scans skip it
        get().existingUrls.add(novelUrl);

        // 4. Scrape chapters
        update({
            status: "scraping",
            progress: { completed: 0, total: novelInfo.chapters.length, current: "Bắt đầu tải..." },
        });

        const results = await scrapeChapters(
            novelInfo.chapters,
            adapter,
            (completed, total, current) => {
                update({ progress: { completed, total, current } });
            },
            ac.signal,
            undefined,
            2000,
        );

        ac.signal.throwIfAborted();

        // 5. Save chapters to IDB
        update({ progress: { completed: results.length, total: results.length, current: "Đang lưu..." } });

        const chapterPuts = results.map((ch, i) => ({
            id: `${novelId}-ch-${i}`,
            novelId,
            title: ch.title || `Chương ${i + 1}`,
            order: ch.order ?? i,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        const scenePuts = results.map((ch, i) => ({
            id: `${novelId}-sc-${i}`,
            chapterId: `${novelId}-ch-${i}`,
            novelId,
            title: ch.title || `Chương ${i + 1}`,
            content: ch.content,
            order: ch.order ?? i,
            wordCount: ch.content.split(/\s+/).length,
            version: 1,
            versionType: "manual" as any,
            isActive: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        await db.chapters.bulkPut(chapterPuts);
        await db.scenes.bulkPut(scenePuts);

        update({
            status: "done",
            progress: { completed: results.length, total: results.length, current: "Đang tải lên Reading Room..." },
        });

        // 6. Upload to Reading Room
        try {
            const { exportNovel } = await import("../novel-io");
            const exportData = await exportNovel(novelId);
            const jsonString = JSON.stringify(exportData);
            const { compress } = await import("../compression");
            const compressed = await compress(jsonString);

            const metadata = {
                id: novelId,
                title: exportData.novel?.title || job.novel.title || '',
                author: exportData.novel?.author || job.novel.author || '',
                // Truncate description to 100 chars in headers to avoid Cloudflare 8KB limit (server extracts full description from compressed body)
                description: (exportData.novel?.description || '').substring(0, 100),
                coverImage: exportData.novel?.coverImage || job.novel.coverImage || '',
                chapterCount: exportData.chapters?.length || results.length,
                genres: exportData.novel?.genres || [],
            };

            let uploadSuccess = false;
            let uploadErrorMsg = '';

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const uploadRes = await fetch(`/api/reading-room?action=upload&novelId=${novelId}`, {
                        method: "POST",
                        headers: {
                            'Content-Type': 'application/octet-stream',
                            'x-novel-metadata': encodeURIComponent(JSON.stringify(metadata))
                        },
                        body: new Blob([compressed as any])
                    });

                    if (uploadRes.ok) {
                        uploadSuccess = true;
                        break;
                    } else {
                        const errJson = await uploadRes.json().catch(() => ({}));
                        uploadErrorMsg = errJson.error || `HTTP Error ${uploadRes.status}`;
                        // Do not retry for non-transient status codes (e.g. 400, 401, 403, 404)
                        const transientStatusCodes = [429, 502, 503, 504];
                        if (!transientStatusCodes.includes(uploadRes.status)) {
                            break;
                        }
                    }
                } catch (err: any) {
                    uploadErrorMsg = err.message || "Lỗi kết nối khi tải lên";
                }
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
            }

            if (!uploadSuccess) {
                throw new Error(uploadErrorMsg || "Lỗi tải lên sau nhiều lần thử");
            }

            // Xóa cục bộ sau khi upload thành công
            const { deleteNovel } = await import("../hooks/use-novels");
            await deleteNovel(novelId);

            update({ progress: { completed: results.length, total: results.length, current: "Hoàn tất & Đã tải lên (Đã dọn dẹp bộ nhớ)!" } });
        } catch (uploadErr: any) {
            console.error("Upload error:", uploadErr);
            update({ progress: { completed: results.length, total: results.length, current: `Hoàn tất (Lỗi tải lên: ${uploadErr.message})` } });
        }

        set((s) => ({ completedCount: s.completedCount + 1 }));
    } catch (err: any) {
        if (err.name === "AbortError" || err.message?.includes("aborted")) {
            update({ status: "cancelled", error: "Đã hủy" });
        } else {
            update({ status: "error", error: err.message || "Lỗi không xác định" });
            set((s) => ({ failedCount: s.failedCount + 1 }));
        }
    }

    // Notify the store that a slot is free
    get()._onJobFinished(jobId);
}
