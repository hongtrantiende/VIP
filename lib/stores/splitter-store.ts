import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SplitterWorkerConfig {
  id: number;
  providerId: string;
  modelId: string;
  sourceDict: string;
  targetGenre: string;
}

interface SplitterState {
  sourceDict: string;
  setSourceDict: (source: string) => void;
  
  workerConfigs: SplitterWorkerConfig[];
  setWorkerConfigs: (configs: SplitterWorkerConfig[]) => void;
  
  chunkSize: number;
  setChunkSize: (size: number) => void;
  
  genreSequence: string[];
  setGenreSequence: (seq: string[]) => void;
}

export const useSplitterStore = create<SplitterState>()(
  persist(
    (set) => ({
      sourceDict: "vietphrase",
      setSourceDict: (source) => set({ sourceDict: source }),
      
      workerConfigs: [
        { id: 1, providerId: "", modelId: "", sourceDict: "core_names", targetGenre: "tienhiep" },
        { id: 2, providerId: "", modelId: "", sourceDict: "core_names", targetGenre: "hiendai" },
        { id: 3, providerId: "", modelId: "", sourceDict: "core_names", targetGenre: "ngontinh" },
        { id: 4, providerId: "", modelId: "", sourceDict: "core_names", targetGenre: "huyenhuyen" },
        { id: 5, providerId: "", modelId: "", sourceDict: "core_names", targetGenre: "khoahuyen" },
      ],
      setWorkerConfigs: (configs) => set({ workerConfigs: configs }),
      
      chunkSize: 10,
      setChunkSize: (size) => set({ chunkSize: size }),
      
      genreSequence: ["tienhiep", "huyenhuyen", "khoahuyen", "vongdu", "dothi", "hiendai", "ngontinh", "quybi", "xuyenkhong", "hethong", "dongphuong", "dammi", "hocduong", "nsfw", "hentai"],
      setGenreSequence: (seq) => set({ genreSequence: seq }),
    }),
    {
      name: "splitter-storage",
    }
  )
);
