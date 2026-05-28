import { streamText } from "ai";
import type { LanguageModel } from "ai";
import { toast } from "sonner";

import { getModel } from "@/lib/ai/provider";
import { resolveStep } from "@/lib/ai/resolve-step";
import type { StepModelConfig, AIProvider, ChatSettings } from "@/lib/db";
import { useChapterTools } from "@/lib/stores/chapter-tools";

export function getChapterToolModelMissingMessage(
  provider: AIProvider | undefined,
): string {

  return "Vui lòng cấu hình nhà cung cấp AI trong Cài đặt.";
}

/**
 * Resolve a per-mode model or fall back to the default chat model.
 */
export async function resolveChapterToolModel(
  stepConfig: StepModelConfig | undefined,
  provider: AIProvider | undefined,
  chatSettings: ChatSettings | undefined,
): Promise<LanguageModel | null> {
  const stepModel = await resolveStep(stepConfig);
  if (stepModel) return stepModel;
  if (provider && chatSettings?.modelId) {
    return await getModel(provider, chatSettings.modelId);
  }
  return null;
}

/**
 * Run a streaming AI call with RAF-throttled store updates.
 * Returns the accumulated result string, or null if cancelled/failed.
 */
export async function runChapterToolStream(opts: {
  model: LanguageModel;
  system: string;
  prompt: string;
  cancelMessage: string;
  errorPrefix: string;
  onComplete?: (result: string) => void;
}): Promise<string | null> {
  const store = useChapterTools.getState();
  store.startStreaming();
  const controller = useChapterTools.getState().abortController;

  let accumulated = "";
  let rafId = 0;
  const flush = () => {
    // Guard: only flush if still streaming (prevents stale RAF after cancel)
    if (useChapterTools.getState().isStreaming) {
      useChapterTools.getState().setStreamingContent(accumulated);
    }
    rafId = 0;
  };

  let activeSystem = opts.system;
  let hasTriedNsfwFallback = false;

  while (true) {
    try {
      accumulated = "";
      const result = streamText({
        model: opts.model,
        system: activeSystem,
        prompt: opts.prompt,
        abortSignal: controller?.signal,
        maxOutputTokens: 25000, // Ensure long chapters are not truncated
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          accumulated += part.text ?? "";
          if (!rafId) rafId = requestAnimationFrame(flush);
        }
      }
      cancelAnimationFrame(rafId);

      // If user cancelled while buffered chunks were still being consumed,
      // the loop may exit normally without throwing AbortError. Bail out.
      if (controller?.signal.aborted) {
        return null;
      }

      const finishReason = await result.finishReason;
      if (finishReason === "length") {
        toast.warning("Bản dịch bị cắt bớt do vượt quá giới hạn độ dài của AI. Hãy thử chia nhỏ chương hoặc dùng mô hình mạnh hơn.");
      }

      // Empty response = content likely filtered/prohibited by provider
      if (!accumulated.trim()) {
        if (!hasTriedNsfwFallback) {
          hasTriedNsfwFallback = true;
          console.warn("[Auto-NSFW] Dịch trả về rỗng. Tự động bật chế độ NSFW R-18+ và thử lại...");
          toast.warning("⚠️ Phát hiện cảnh nhạy cảm bị chặn. Đang tự động kích hoạt chế độ NSFW R-18+ để dịch lại...");
          const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
          activeSystem = `${activeSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
          continue;
        }

        const msg = "Nhà cung cấp AI trả về nội dung trống — có thể nội dung đã bị chặn bởi bộ lọc an toàn. Hãy thử chỉnh sửa prompt tùy chỉnh, Chỉ thị chung, hoặc đổi mô hình AI khác.";
        toast.error(msg);
        useChapterTools.getState().cancelStreaming();
        return null;
      }

      useChapterTools.getState().setStreamingContent(accumulated);
      useChapterTools.getState().finishStreaming(accumulated);
      opts.onComplete?.(accumulated);
      return accumulated;
    } catch (err: any) {
      // Cancel any pending RAF to prevent stale content flush after abort
      cancelAnimationFrame(rafId);
      if (err instanceof Error && err.name === "AbortError") {
        toast.info(opts.cancelMessage);
        return null;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const lowerErr = errMsg.toLowerCase();
      const isSafetyBlock = lowerErr.includes('safety') || 
                            lowerErr.includes('content filter') || 
                            lowerErr.includes('blocked') || 
                            lowerErr.includes('finish_reason') ||
                            lowerErr.includes('finishreason') ||
                            lowerErr.includes('candidate');

      if (isSafetyBlock && !hasTriedNsfwFallback) {
        hasTriedNsfwFallback = true;
        console.warn("[Auto-NSFW] Bộ lọc an toàn chặn cuộc gọi. Tự động bật chế độ NSFW R-18+ và thử lại...", err);
        toast.warning("⚠️ Phát hiện cảnh nhạy cảm bị bộ lọc chặn. Đang tự động kích hoạt chế độ NSFW R-18+ để dịch lại...");
        const { NSFW_INSTRUCTION } = await import("@/lib/writing/prompts");
        activeSystem = `${activeSystem}\n\n# CHỈ DẪN VĂN PHONG ĐẶC BIỆT BỔ SUNG (BẮT BUỘC TUÂN THỦ DÙ LÀ REWRITE HAY DỊCH):\n${NSFW_INSTRUCTION}`;
        continue;
      }

      const msg = err instanceof Error ? err.message : "Lỗi không xác định";
      toast.error(`${opts.errorPrefix}: ${msg}`);
      useChapterTools.getState().cancelStreaming();
      return null;
    }
  }
}
