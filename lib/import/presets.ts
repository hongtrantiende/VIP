export interface ChapterPreset {
  label: string;
  pattern: RegExp;
}

export const CHAPTER_PRESETS: Record<string, ChapterPreset> = {
  vietnamese: {
    label: "Chương xx: ...",
    pattern: /^[ \t]*Chương\s+\d+(?:.*)?$/gim,
  },
  english: {
    label: "Chapter xx: ...",
    pattern: /^[ \t]*Chapter\s+\d+(?:.*)?$/gim,
  },
  chinese: {
    label: "第xx[章回节卷]...",
    pattern: /^[ \t]*第[\d零一二三四五六七八九十百千万]+[章回节卷折](?:.*)?$/gm,
  },
  chinese_brackets: {
    label: "【Title】 / (Title)",
    pattern: /^[ \t]*[【\(\[（](第?[\d零一二三四五六七八九十百千万]+[章回节卷折]?)[)\]】）]\s*.*/gm,
  },
  numbered_strict: {
    label: "01. Title / 一、Title",
    pattern: /^[ \t]*[\d零一二三四五六七八九十百千万]+[、.\s\-]+[^\n]+/gm,
  },
};
