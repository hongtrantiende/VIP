import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TrainingSuggestion } from "@/lib/ai/training-tools";
import type { ConvertSegment } from "@/lib/workers/qt-engine.types";

export type ConvertTab = "qt" | "train" | "results";

export interface WorkerConfig {
  id: number;
  providerId: string;
  modelId: string;
}

interface TrainingState {
  input: string;
  output: string;
  segments: ConvertSegment[];
  isTraining: boolean;
  lastProcessedIndex: number;
  trainingSuggestions: TrainingSuggestion[];
  batchProgress: { current: number; total: number } | null;
  isAutoNext: boolean;
  checklistCounts: Record<string, number>;
  extractedTerms: TrainingSuggestion[];
  activeTab: ConvertTab;
  workerConfigs: WorkerConfig[];
  selectedNovelId: string;
  selectedChapterId: string;
  targetGenres: string[];
  totalSyncedWords: number;
  
  // Actions
  setInput: (input: string) => void;
  setOutput: (output: string) => void;
  setSegments: (segments: ConvertSegment[]) => void;
  setIsTraining: (isTraining: boolean) => void;
  setLastProcessedIndex: (index: number) => void;
  setTrainingSuggestions: (suggestions: TrainingSuggestion[]) => void;
  setBatchProgress: (progress: { current: number; total: number } | null) => void;
  setIsAutoNext: (isAutoNext: boolean) => void;
  incrementChecklistCount: (category: string) => void;
  setExtractedTerms: (terms: TrainingSuggestion[]) => void;
  addExtractedTerms: (terms: TrainingSuggestion[]) => void;
  removeExtractedTerm: (term: TrainingSuggestion) => void;
  setActiveTab: (tab: ConvertTab) => void;
  setWorkerConfigs: (configs: WorkerConfig[]) => void;
  updateWorkerConfig: (id: number, updates: Partial<WorkerConfig>) => void;
  setSelectedNovelId: (id: string) => void;
  setSelectedChapterId: (id: string) => void;
  setTargetGenres: (genres: string[]) => void;
  addSyncedWords: (count: number) => void;
  resetTraining: () => void;
}

export const useTrainingStore = create<TrainingState>()(
  persist(
    (set) => ({
      input: "",
      output: "",
      segments: [],
      isTraining: false,
      lastProcessedIndex: 0,
      trainingSuggestions: [],
      batchProgress: null,
      isAutoNext: false,
      checklistCounts: {},
      extractedTerms: [],
      activeTab: "qt" as ConvertTab,
      workerConfigs: Array.from({ length: 5 }).map((_, i) => ({
        id: i + 1,
        providerId: "",
        modelId: "",
      })),
      selectedNovelId: "",
      selectedChapterId: "",
      targetGenres: ["auto"],
      totalSyncedWords: 0,

      setInput: (input) => set({ input }),
      setOutput: (output) => set({ output }),
      setSegments: (segments) => set({ segments }),
      setIsTraining: (isTraining) => set({ isTraining }),
      setLastProcessedIndex: (lastProcessedIndex) => set({ lastProcessedIndex }),
      setTrainingSuggestions: (trainingSuggestions) => set({ trainingSuggestions }),
      setBatchProgress: (batchProgress) => set({ batchProgress }),
      setIsAutoNext: (isAutoNext) => set({ isAutoNext }),
      incrementChecklistCount: (category) => set((state) => ({
        checklistCounts: {
          ...state.checklistCounts,
          [category]: (state.checklistCounts[category] || 0) + 1
        }
      })),
      setExtractedTerms: (terms) => set({ extractedTerms: terms }),
      addExtractedTerms: (terms) => set((state) => {
        const existingKeys = new Set(state.extractedTerms.map(t => t.chinese));
        const newTerms = terms.filter(t => !existingKeys.has(t.chinese));
        return { extractedTerms: [...newTerms, ...state.extractedTerms] };
      }),
      removeExtractedTerm: (term) => set((state) => ({ extractedTerms: state.extractedTerms.filter(t => t !== term) })),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setWorkerConfigs: (configs) => set({ workerConfigs: configs }),
      updateWorkerConfig: (id, updates) => set((state) => ({
        workerConfigs: state.workerConfigs.map(w => w.id === id ? { ...w, ...updates } : w)
      })),
      setSelectedNovelId: (id) => set({ selectedNovelId: id }),
      setSelectedChapterId: (id) => set({ selectedChapterId: id }),
      setTargetGenres: (genres) => set({ targetGenres: genres }),
      addSyncedWords: (count) => set((state) => ({ totalSyncedWords: (state.totalSyncedWords || 0) + count })),
      resetTraining: () => set({
        isTraining: false,
        lastProcessedIndex: 0,
        trainingSuggestions: [],
        batchProgress: null,
        checklistCounts: {},
      }),
    }),
    {
      name: "training-storage",
      storage: createJSONStorage(() => localStorage),
      version: 6,
      partialize: (state) => ({
        input: state.input,
        output: state.output,
        lastProcessedIndex: state.lastProcessedIndex,
        isAutoNext: state.isAutoNext,
        checklistCounts: state.checklistCounts,
        extractedTerms: state.extractedTerms,
        activeTab: state.activeTab,
        workerConfigs: state.workerConfigs,
        selectedNovelId: state.selectedNovelId,
        selectedChapterId: state.selectedChapterId,
        targetGenres: state.targetGenres,
        totalSyncedWords: state.totalSyncedWords,
      }),
      migrate: (persistedState: any, version: number) => {
        const defaultWorkers = Array.from({ length: 5 }).map((_, i) => ({
          id: i + 1, providerId: "", modelId: "",
        }));
        if (version < 2) {
          return { ...persistedState, extractedTerms: [], activeTab: "qt", workerConfigs: defaultWorkers };
        }
        if (version < 3) {
          return { ...persistedState, workerConfigs: defaultWorkers };
        }
        if (version < 4) {
          const configs = persistedState.workerConfigs;
          if (!configs || configs.length === 0) {
            return { ...persistedState, workerConfigs: defaultWorkers };
          }
        }
        if (version < 6) {
          return { 
            ...persistedState, 
            targetGenres: persistedState.targetGenre ? [persistedState.targetGenre] : ["auto"] 
          };
        }
        return persistedState as TrainingState;
      },
    }
  )
);
