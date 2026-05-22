"use client";

import { useReaderPanel } from "@/lib/stores/reader-panel";
import { tokenizeSentences } from "@/lib/tts";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ObfuscatedText } from "@/components/reader/obfuscated-text";

/**
 * Splits content into lines and computes the sentence index range for each line.
 * Empty lines (paragraph breaks) are represented as { isBlank: true }.
 */
function buildLineRanges(
  content: string,
): ({ isBlank: true } | { isBlank: false; start: number; end: number })[] {
  const lines = content.split("\n");
  let offset = 0;
  return lines.map((line) => {
    if (!line.trim()) return { isBlank: true };
    const count = tokenizeSentences(line).length;
    const range = {
      isBlank: false as const,
      start: offset,
      end: offset + count,
    };
    offset += count;
    return range;
  });
}

export function SentenceRenderer({ content }: { content: string }) {
  const sentences = useMemo(() => tokenizeSentences(content), [content]);
  const lineRanges = useMemo(() => buildLineRanges(content), [content]);
  const setSentences = useReaderPanel((s) => s.setSentences);
  const currentSentenceIndex = useReaderPanel((s) => s.currentSentenceIndex);
  const isPlaying = useReaderPanel((s) => s.isPlaying);
  const isPaused = useReaderPanel((s) => s.isPaused);
  const highlightColor = useReaderPanel((s) => s.ttsSettings.highlightColor);

  const activeRef = useRef<HTMLSpanElement>(null);

  // Sync sentences to store whenever content changes
  useEffect(() => {
    setSentences(sentences);
  }, [sentences, setSentences]);

  // Scroll active sentence into view
  useEffect(() => {
    if ((isPlaying || isPaused) && activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [currentSentenceIndex, isPlaying, isPaused]);

  const isActive = useCallback(
    (index: number) =>
      (isPlaying || isPaused) && index === currentSentenceIndex,
    [isPlaying, isPaused, currentSentenceIndex],
  );

  if (!content) {
    return (
      <p className="italic text-muted-foreground">
        Chương này chưa có nội dung.
      </p>
    );
  }

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      {lineRanges.map((line, i) =>
        line.isBlank ? (
          <div key={i} className="mt-4" />
        ) : (
          <div key={i} className="mb-6">
            {sentences.slice(line.start, line.end).map((sentence) => (
              <span
                key={sentence.index}
                ref={isActive(sentence.index) ? activeRef : undefined}
                data-sentence-index={sentence.index}
                className={cn(
                  "transition-colors duration-200 mr-0.75",
                  isActive(sentence.index) &&
                  "rounded-sm ring-1 ring-primary/20",
                )}
                style={
                  isActive(sentence.index)
                    ? { backgroundColor: highlightColor }
                    : undefined
                }
              >
                <ObfuscatedText text={sentence.originalText} />
              </span>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
