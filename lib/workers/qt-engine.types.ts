export type ConvertSource =
  | "novel-name"
  | "global-name"
  | "qt-name"
  | "auto-name"
  | "vietphrase"
  | "genre-vietphrase"
  | "core-vietphrase"
  | "phienam"
  | "luatnhan"
  | "unknown";

export interface ConvertSegment {
  original: string;
  translated: string;
  source: ConvertSource;
  posTag?: string;
  inDialogue?: boolean;
}

export interface DictPair {
  chinese: string;
  vietnamese: string;
}

// ─── Convert Options ──────────────────────────────────────────

/** Which dict gets higher priority when both have the same key */
export type NameVsPriority = "name-first" | "vp-first";

/** Whether novel-specific names override global or vice versa */
export type ScopePriority = "novel-first" | "global-first";

/** Min length filter for vietphrase entries */
export type VpLengthPriority = "none" | "long-first" | "vp-gt-3" | "vp-gt-4";

/** LuatNhan application mode */
export type LuatNhanMode = "off" | "name-only" | "name-and-pronouns";

/** How to split text before converting */
export type SplitMode = "sentence" | "paragraph";

export interface ConvertOptions {
  /** name dict vs vietphrase priority (default: "name-first") */
  nameVsPriority?: NameVsPriority;
  /** Which genre dictionaries to activate (e.g. ['tienhiep', 'hethong']). Applied before vietphrase. */
  activeDictSources?: string[];
  /** novel-specific vs global name priority (default: "novel-first") */
  scopePriority?: ScopePriority;
  /** Max phrase length to try matching (default: 12) */
  maxPhraseLength?: number;
  /** VP length priority filter (default: "none") */
  vpLengthPriority?: VpLengthPriority;
  /** LuatNhan mode (default: "name-only") */
  luatNhanMode?: LuatNhanMode;
  /** Split mode for text processing (default: "paragraph") */
  splitMode?: SplitMode;
  /** Capitalize all words inside 《》 and «» brackets (default: false) */
  capitalizeBrackets?: boolean;
  /** Auto-detect names based on surname + frequency heuristic (default: true) */
  autoDetectNames?: boolean;
  /** Minimum occurrences for auto-detected names (default: 3) */
  nameDetectMinFrequency?: number;
  /** Auto-detected names to exclude (not persisted in settings) */
  rejectedAutoNames?: string[];
  /** Enable POS tagging via jieba-wasm (default: true) */
  posTaggingEnabled?: boolean;
  /** Prefer Hán Việt readings for detected names (default: false) */
  preferPhienAmForNames?: boolean;
  /** Fix common ordinal patterns like "thứ một" -> "1" (default: true) */
  fixOrdinals?: boolean;
  /** Provider ID for AI training/completion services */
  trainingProviderId?: string;
  /** Model ID for AI training/completion services */
  trainingModelId?: string;
  /** Priority order for dictionary merging */
  dictPriority?: string[];
}

export const DEFAULT_CONVERT_OPTIONS: ConvertOptions = {
  nameVsPriority: "name-first",
  scopePriority: "novel-first",
  maxPhraseLength: 10,
  vpLengthPriority: "none",
  luatNhanMode: "name-only",
  splitMode: "paragraph",
  capitalizeBrackets: true,
  autoDetectNames: true,
  nameDetectMinFrequency: 3,
  posTaggingEnabled: true,
  preferPhienAmForNames: true,
  fixOrdinals: true,
  trainingProviderId: "",
  trainingModelId: "",
  dictPriority: ["luatnhan", "names", "names2", "ngucanh", "tuvung", "vietphrase", "phienam"],
};

// Main → Worker
export type QTWorkerRequest =
  | {
      type: "init";
      dictData: Record<string, DictPair[]>;
    }
  | {
      type: "convert";
      id: string;
      text: string;
      novelNames?: DictPair[];
      globalNames?: DictPair[];
      options?: ConvertOptions;
    }
  | {
      type: "convert-batch";
      id: string;
      items: Array<{ itemId: string; text: string }>;
      novelNames?: DictPair[];
      globalNames?: DictPair[];
      options?: ConvertOptions;
    };

// Worker → Main
export type QTWorkerResponse =
  | { type: "ready" }
  | {
      type: "result";
      id: string;
      segments: ConvertSegment[];
      plainText: string;
      detectedNames?: DictPair[];
    }
  | {
      type: "batch-progress";
      id: string;
      itemId: string;
      segments: ConvertSegment[];
      plainText: string;
      detectedNames?: DictPair[];
    }
  | { type: "batch-complete"; id: string }
  | { type: "error"; id: string; message: string };
