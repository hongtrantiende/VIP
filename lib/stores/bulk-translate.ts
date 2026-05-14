import { create } from "zustand";

export type ChapterTranslateStatus = "pending" | "translating" | "done" | "error";

export interface TranslateChapterResult {
  chapterId: string;
  chapterTitle: string;
  originalTitle: string;
  newTitle?: string;
  originalLineCount: number;
  translatedLineCount: number;
  /** Per-scene translated content, keyed by scene ID */
  scenes: { sceneId: string; content: string }[];
}

export interface TranslateError {
  chapterId: string;
  chapterTitle: string;
  message: string;
}

export interface NovelJobState {
  step: "config" | "progress" | "results";
  isRunning: boolean;
  isPaused: boolean;
  chapterIds: string[];
  statuses: Map<string, ChapterTranslateStatus>;
  currentChapterId: string | null;
  chaptersCompleted: number;
  totalChapters: number;
  results: Map<string, TranslateChapterResult>;
  errors: TranslateError[];
  savedChapterIds: Set<string>;
  abortController: AbortController | null;
  providerId?: string;
  modelId?: string;
}

interface BulkTranslateState {
  jobs: Record<string, NovelJobState>;

  // Actions
  initJob: (novelId: string) => void;
  start: (novelId: string, chapterIds: string[], providerId?: string, modelId?: string) => void;
  setStep: (novelId: string, step: NovelJobState["step"]) => void;
  setChapterStatus: (novelId: string, chapterId: string, status: ChapterTranslateStatus) => void;
  setCurrentChapter: (novelId: string, chapterId: string | null) => void;
  addResult: (novelId: string, result: TranslateChapterResult) => void;
  addError: (novelId: string, error: TranslateError) => void;
  markSaved: (novelId: string, chapterIds: string[]) => void;
  incrementCompleted: (novelId: string) => void;
  finish: (novelId: string) => void;
  startRetry: (novelId: string, failedIds: string[]) => void;
  pause: (novelId: string) => void;
  resume: (novelId: string) => void;
  cancel: (novelId: string) => void;
  reset: (novelId: string) => void;
  updateTotalChapters: (novelId: string, total: number) => void;
}

const defaultJobState: NovelJobState = {
  step: "config",
  isRunning: false,
  isPaused: false,
  chapterIds: [],
  statuses: new Map(),
  currentChapterId: null,
  chaptersCompleted: 0,
  totalChapters: 0,
  results: new Map(),
  errors: [],
  savedChapterIds: new Set(),
  abortController: null,
};

export const useBulkTranslateStore = create<BulkTranslateState>((set, get) => ({
  jobs: {},

  initJob: (novelId) => {
    if (!get().jobs[novelId]) {
      set((s) => ({ jobs: { ...s.jobs, [novelId]: { ...defaultJobState } } }));
    }
  },

  start: (novelId, chapterIds, providerId, modelId) => {
    const statuses = new Map<string, ChapterTranslateStatus>();
    for (const id of chapterIds) statuses.set(id, "pending");
    set((s) => ({
      jobs: {
        ...s.jobs,
        [novelId]: {
          ...defaultJobState,
          step: "progress",
          isRunning: true,
          isPaused: false,
          chapterIds,
          statuses,
          totalChapters: chapterIds.length,
          abortController: new AbortController(),
          providerId,
          modelId,
        },
      },
    }));
  },

  setStep: (novelId, step) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, step } } };
    }),

  setChapterStatus: (novelId, chapterId, status) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      const statuses = new Map(job.statuses);
      statuses.set(chapterId, status);
      return { jobs: { ...s.jobs, [novelId]: { ...job, statuses } } };
    }),

  setCurrentChapter: (novelId, chapterId) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, currentChapterId: chapterId } } };
    }),

  addResult: (novelId, result) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      const results = new Map(job.results);
      results.set(result.chapterId, result);
      return { jobs: { ...s.jobs, [novelId]: { ...job, results } } };
    }),

  addError: (novelId, error) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, errors: [...job.errors, error] } } };
    }),

  markSaved: (novelId, chapterIds) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      const saved = new Set(job.savedChapterIds);
      for (const id of chapterIds) saved.add(id);
      return { jobs: { ...s.jobs, [novelId]: { ...job, savedChapterIds: saved } } };
    }),

  incrementCompleted: (novelId) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, chaptersCompleted: job.chaptersCompleted + 1 } } };
    }),

  finish: (novelId) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, isRunning: false, step: "results" } } };
    }),

  startRetry: (novelId, failedIds) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      const newStatuses = new Map(job.statuses);
      for (const id of failedIds) newStatuses.set(id, "pending");
      return {
        jobs: {
          ...s.jobs,
          [novelId]: {
            ...job,
            isRunning: true,
            isPaused: false,
            step: "progress",
            statuses: newStatuses,
            errors: job.errors.filter((e) => !failedIds.includes(e.chapterId)),
            chaptersCompleted: job.results.size,
            abortController: new AbortController(),
          },
        },
      };
    }),

  pause: (novelId) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job || !job.isRunning) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, isPaused: true } } };
    }),

  resume: (novelId) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job || !job.isRunning) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, isPaused: false } } };
    }),

  cancel: (novelId) => {
    const job = get().jobs[novelId];
    if (job) {
      job.abortController?.abort();
      set((s) => ({ jobs: { ...s.jobs, [novelId]: { ...job, isRunning: false, step: "results" } } }));
    }
  },

  reset: (novelId) =>
    set((s) => ({
      jobs: { ...s.jobs, [novelId]: { ...defaultJobState } },
    })),

  updateTotalChapters: (novelId, total) =>
    set((s) => {
      const job = s.jobs[novelId];
      if (!job) return s;
      return { jobs: { ...s.jobs, [novelId]: { ...job, totalChapters: total } } };
    }),
}));
