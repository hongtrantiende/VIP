"use client";

import { ScrollToBottom } from "@/components/chat/scroll-to-bottom";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useStepResult } from "@/lib/hooks";
import { useWritingPipelineStore } from "@/lib/stores/writing-pipeline";
import { countWords } from "@/lib/utils";
import { LoaderIcon, PenLineIcon, RefreshCwIcon, SaveIcon, SparklesIcon } from "lucide-react";
import { useLayoutEffect } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

/** Pins scroll during pipeline writer / rewrite streaming (ResizeObserver path uses preserveScrollPosition). */
function StreamingScrollFollow({
  isStreaming,
  contentLength,
}: {
  isStreaming: boolean;
  contentLength: number;
}) {
  const { scrollToBottom } = useStickToBottomContext();

  useLayoutEffect(() => {
    if (!isStreaming) return;
    void scrollToBottom({
      animation: "instant",
      preserveScrollPosition: false,
    });
  }, [isStreaming, contentLength, scrollToBottom]);

  return null;
}

export function ChapterPreview({
  sessionId,
  onRegenerateAction,
  onSaveAction,
  onPromptConfigAction,
  /** True while writer step is active but DB row may not be "running" yet (avoids empty flash). */
  assumeStreaming,
  /** True while standalone rewrite runs (uses same store streaming buffer as pipeline writer). */
  isRewriting,
}: {
  sessionId: string | undefined;
  onRegenerateAction?: () => void;
  onSaveAction?: () => void;
  onPromptConfigAction?: () => void;
  assumeStreaming?: boolean;
  isRewriting?: boolean;
}) {
  const stepResult = useStepResult(sessionId, "writer");
  const streamingContent = useWritingPipelineStore((s) => s.streamingContent);
  const writerActivityLabel = useWritingPipelineStore(
    (s) => s.writerActivityLabel,
  );
  const isRunning = useWritingPipelineStore((s) => s.isRunning);

  const writerDraft = stepResult?.output ?? "";
  const streamText = streamingContent;
  const content =
    (isRunning || isRewriting) && streamText ? streamText : writerDraft;

  const wordCount = countWords(content);
  const writerStepRunning = stepResult?.status === "running";
  const isStreaming =
    !!assumeStreaming ||
    (isRunning && writerStepRunning) ||
    Boolean(isRewriting);

  if (!content && !isStreaming) {
    return (
      <Empty className="h-full min-h-[200px]">
        <EmptyMedia variant="icon">
          <PenLineIcon />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>Nội dung chương</EmptyTitle>
          <EmptyDescription>
            Nội dung sẽ được viết sau khi bạn duyệt giàn ý. AI sẽ viết từng phân
            cảnh và hiển thị real-time tại đây.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          {isStreaming && (
            <LoaderIcon className="h-4 w-4 animate-spin text-primary" />
          )}
          <span className="text-sm font-medium">
            {isStreaming
              ? isRewriting
                ? "Đang viết lại theo đánh giá..."
                : writerActivityLabel.trim() || "Đang viết..."
              : "Nội dung chương"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {wordCount.toLocaleString()} từ
          </span>
          {isStreaming ? (
            <div className="flex gap-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {onPromptConfigAction && (
                <button
                  onClick={onPromptConfigAction}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 hover:text-violet-700 transition-colors border border-violet-200 dark:border-violet-800 font-semibold"
                  title="Tùy chỉnh Prompt của AI bằng ý tưởng"
                >
                  <SparklesIcon className="h-3 w-3" />
                  Chỉnh prompt
                </button>
              )}
              {onSaveAction && (
                <button
                  onClick={onSaveAction}
                  className="flex items-center gap-1 rounded-md bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 text-xs font-semibold shadow-sm transition-all duration-150"
                  title="Lưu chương này vào truyện chính thức"
                >
                  <SaveIcon className="h-3 w-3" />
                  Lưu vào truyện
                </button>
              )}
              {onRegenerateAction && (
                <button
                  onClick={onRegenerateAction}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors border border-border"
                  title="Viết lại nội dung"
                >
                  <RefreshCwIcon className="h-3 w-3" />
                  Viết lại
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <StickToBottom
        className="relative h-full min-h-0 overflow-hidden"
        resize="smooth"
        initial="instant"
      >
        <StickToBottom.Content className="p-6">
          <div className="mx-auto max-w-2xl">
            <div className="prose prose-sm max-w-none whitespace-pre-wrap dark:prose-invert font-serif leading-relaxed">
              {content}
              {isStreaming && (
                <span className="inline-block h-4 w-0.5 bg-foreground animate-pulse ml-0.5" />
              )}
            </div>
          </div>
        </StickToBottom.Content>
        <StreamingScrollFollow
          isStreaming={isStreaming}
          contentLength={content.length}
        />
        <ScrollToBottom />
      </StickToBottom>
    </div>
  );
}
