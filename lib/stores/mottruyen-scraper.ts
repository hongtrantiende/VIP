import { create } from "zustand";

export interface MottruyenProgressData {
    name: string;
    downloaded: number;
    total: number;
    status: string;
}

interface MottruyenStoreState {
    status: "idle" | "running" | "paused" | "finished";
    currentId: number;
    endId: number;
    batchSize: number;
    categoryFilter: string;
    progressData: Record<string, MottruyenProgressData>;
    successCount: number;
    totalProcessed: number;

    setStatus: (status: "idle" | "running" | "paused" | "finished") => void;
    setCurrentId: (id: number) => void;
    setEndId: (id: number) => void;
    setBatchSize: (size: number) => void;
    setCategoryFilter: (filter: string) => void;
    setProgressData: (fn: (prev: Record<string, MottruyenProgressData>) => Record<string, MottruyenProgressData>) => void;
    setSuccessCount: (c: number) => void;
    setTotalProcessed: (c: number) => void;
    reset: () => void;
}

export const useMottruyenStore = create<MottruyenStoreState>((set) => ({
    status: "idle",
    currentId: 800,
    endId: 1000000,
    batchSize: 100,
    categoryFilter: "",
    progressData: {},
    successCount: 0,
    totalProcessed: 0,

    setStatus: (status) => set({ status }),
    setCurrentId: (currentId) => {
        mottruyenGlobalRefs.currentId = currentId;
        set({ currentId });
    },
    setEndId: (endId) => set({ endId }),
    setBatchSize: (batchSize) => set({ batchSize }),
    setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
    setProgressData: (fn) => set((state) => ({ progressData: fn(state.progressData) })),
    setSuccessCount: (successCount) => {
        mottruyenGlobalRefs.successCount = successCount;
        set({ successCount });
    },
    setTotalProcessed: (totalProcessed) => {
        mottruyenGlobalRefs.totalProcessed = totalProcessed;
        set({ totalProcessed });
    },
    reset: () => {
        Object.assign(mottruyenGlobalRefs, {
            downloadQueue: [],
            activeDownloadsCount: 0,
            successCount: 0,
            totalProcessed: 0,
            currentId: 800,
        });
        set({
            status: "idle",
            currentId: 800,
            progressData: {},
            successCount: 0,
            totalProcessed: 0
        });
    }
}));

// Đối tượng lưu trữ toàn cục giúp bảo tồn trạng thái hàng đợi khi Unmount React Component
export const mottruyenGlobalRefs = {
    downloadQueue: [] as any[],
    activeDownloadsCount: 0,
    successCount: 0,
    totalProcessed: 0,
    currentId: 800,
    readingRoomIndex: new Set<string>()
};
