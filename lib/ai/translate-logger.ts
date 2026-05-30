import { create } from "zustand";

export interface TranslateLog {
  chapterTitle?: string;
  systemPrompt: string;
  userPrompt: string;
  output: string;
  timestamp: Date;
}

interface AiTranslateLogState {
  model1Logs: Record<string, TranslateLog[]>; // novelId -> logs
  model2Logs: Record<string, TranslateLog[]>; // novelId -> logs
  addModel1Log: (novelId: string, log: TranslateLog) => void;
  addModel2Log: (novelId: string, log: TranslateLog) => void;
  clearLogs: (novelId: string) => void;
}

export const useAiTranslateLogStore = create<AiTranslateLogState>((set) => ({
  model1Logs: {},
  model2Logs: {},
  addModel1Log: (novelId, log) => set((state) => {
    const existing = state.model1Logs[novelId] || [];
    // Keep last 20 logs to avoid bloating memory
    return {
      model1Logs: {
        ...state.model1Logs,
        [novelId]: [log, ...existing].slice(0, 20),
      }
    };
  }),
  addModel2Log: (novelId, log) => set((state) => {
    const existing = state.model2Logs[novelId] || [];
    return {
      model2Logs: {
        ...state.model2Logs,
        [novelId]: [log, ...existing].slice(0, 20),
      }
    };
  }),
  clearLogs: (novelId) => set((state) => ({
    model1Logs: { ...state.model1Logs, [novelId]: [] },
    model2Logs: { ...state.model2Logs, [novelId]: [] },
  })),
}));
