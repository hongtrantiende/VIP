import { create } from "zustand";

interface RewriteState {
  isGenerating: boolean;
  phase: string;
  activeNovelId: string | null;
  abortController: AbortController | null;
  setGenerating: (generating: boolean, novelId?: string, controller?: AbortController) => void;
  setPhase: (phase: string) => void;
  abort: () => void;
}

export const useRewriteStore = create<RewriteState>((set, get) => ({
  isGenerating: false,
  phase: "",
  activeNovelId: null,
  abortController: null,
  setGenerating: (isGenerating, novelId, controller) => set({ 
    isGenerating, 
    activeNovelId: isGenerating ? novelId : null, 
    phase: isGenerating ? "Bắt đầu..." : "",
    abortController: isGenerating ? (controller || null) : null
  }),
  setPhase: (phase) => set({ phase }),
  abort: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set({ isGenerating: false, phase: "", activeNovelId: null, abortController: null });
  }
}));
