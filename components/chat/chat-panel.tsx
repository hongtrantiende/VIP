/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildErrorTrace, storeErrorTrace } from "@/lib/ai/error-trace";
import { getModel } from "@/lib/ai/provider";
import { useProfile } from "@/lib/hooks/use-profile";
import { withGlobalInstruction } from "@/lib/ai/system-prompt";
import {
  FILE_INPUT_ACCEPT,
  isSupportedFile,
  readFileAsChat,
} from "@/lib/chat-file-reader";
import type { ChatFile, ChatImage } from "@/lib/db";
import {
  addMessage,
  createConversation,
  deleteConversation,
  deleteMessagesFrom,
  updateChatSettings,
  updateConversation,
  updateMessage,
  useAIModels,
  useAIProviders,
  useChatSettings,
  useConversationMessages,
  useConversations,
} from "@/lib/hooks";
import { useChapterTools } from "@/lib/stores/chapter-tools";
import { useChatPanel } from "@/lib/stores/chat-panel";
import { useReaderPanel } from "@/lib/stores/reader-panel";
import { cn } from "@/lib/utils";
import { APICallError, stepCountIs, streamText } from "ai";
import {
  ArrowUpIcon,
  BotIcon,
  CrownIcon,
  HistoryIcon,
  LoaderIcon,
  PlusIcon,
  SettingsIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import { AttachMenuButton } from "./attach-menu";
import { ChatHistoryDialog } from "./chat-history-dialog";
import { ChatSettingsDialog } from "./chat-settings-dialog";
import { MessageBubble } from "./message-bubble";
import { ModelSelectorButton } from "./model-selector";
import { NovelContextBadge } from "./novel-context-badge";
import { ScrollToBottom } from "./scroll-to-bottom";
import { parseThinkingTags } from "./thinking-parser";

/** Convert a base64 data URL to Uint8Array for Vercel AI SDK image parts. */
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function compressImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 1024;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) {
            height = Math.round((height * MAX) / width);
            width = MAX;
          } else {
            width = Math.round((width * MAX) / height);
            height = MAX;
          }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve({
          dataUrl: canvas.toDataURL(mimeType, 0.85),
          mimeType,
          name: file.name,
        });
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function ChatPanel() {
  const {
    isOpen,
    close,
    activeConversationId,
    setActiveConversation,
    setAttachedContext,
    attachedNovelId,
    attachedChapterId,
    pageNovelId,
    pageChapterId,
  } = useChatPanel();
  const chapterToolActive = useChapterTools((s) => s.activeMode !== null);
  const readerToolsOpen = useReaderPanel((s) => s.isOpen);
  const toolActive = chapterToolActive || readerToolsOpen;
  const isMobile = useIsMobile();

  // Admin model detection
  const { profile, adminModelEnabled } = useProfile();
  const useAdminModel = !!(adminModelEnabled && profile?.admin_assigned_model && (profile.admin_model_quota ?? 0) > 0);
  const adminProvider = useAdminModel ? {
    id: "admin-provider",
    name: "Model Admin",
    baseUrl: "https://dummy.local/api/ai-proxy",
    apiKey: "admin-model-key",
    providerType: "openai-compatible" as const,
  } : null;

  const providers = useAIProviders();
  const chatSettings = useChatSettings();
  const selectedProviderId = useAdminModel ? "admin-provider" : chatSettings.providerId;
  const selectedModelId = useAdminModel ? "admin-model" : chatSettings.modelId;
  const systemPrompt =
    withGlobalInstruction(
      chatSettings.systemPrompt,
      chatSettings.globalSystemInstruction,
    ) ?? "";
  const temperature = chatSettings.temperature;
  const maxToolSteps = chatSettings.maxToolSteps ?? 10;
  const selectedProvider = useAdminModel ? (adminProvider as any) : providers?.find((p) => p.id === selectedProviderId);
  const models = useAIModels(useAdminModel ? undefined : (selectedProviderId || undefined));

  const conversations = useConversations();
  const dbMessages = useConversationMessages(activeConversationId ?? undefined);

  const [streamingContent, setStreamingContent] = useState<string>("");
  const [streamingReasoning, setStreamingReasoning] = useState<string>("");
  const [streamingParts, setStreamingParts] = useState<
    import("@/lib/db").MessagePart[]
  >([]);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Auto-select first provider when none is set
  useEffect(() => {
    if (providers?.length && !selectedProviderId) {
      updateChatSettings({ providerId: providers[0].id });
    }
  }, [providers, selectedProviderId]);

  // Auto-select first model when none is set
  useEffect(() => {
    if (models?.length && !selectedModelId) {
      updateChatSettings({ modelId: models[0].modelId });
    }
  }, [models, selectedModelId]);

  // Sync provider/model and attached context when user switches conversation.
  // Uses syncedConvoIdRef to track successful syncs — allows retrying if
  // conversations (LiveQuery) hasn't populated yet when activeConversationId changes.
  const syncedConvoIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConversationId) {
      setAttachedContext(null, null);
      syncedConvoIdRef.current = null;
      return;
    }
    if (syncedConvoIdRef.current === activeConversationId) return;
    const convo = conversations?.find((c) => c.id === activeConversationId);
    if (!convo) return; // Not yet in LiveQuery — will retry when conversations updates
    updateChatSettings({
      providerId: convo.providerId,
      modelId: convo.modelId,
    });
    setAttachedContext(convo.novelId ?? null, convo.chapterId ?? null);
    syncedConvoIdRef.current = activeConversationId;
  }, [activeConversationId, conversations, setAttachedContext]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // Auto-select latest conversation when panel opens with none selected.
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (
      isOpen &&
      !prevIsOpenRef.current &&
      !activeConversationId &&
      conversations?.length
    ) {
      setActiveConversation(conversations[0].id);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, activeConversationId, conversations, setActiveConversation]);

  // When user navigates to a chapter of the attached novel, sync attachedChapterId.
  useEffect(() => {
    if (
      attachedNovelId &&
      pageNovelId === attachedNovelId &&
      pageChapterId !== attachedChapterId
    ) {
      setAttachedContext(attachedNovelId, pageChapterId);
      if (activeConversationId) {
        updateConversation(activeConversationId, {
          chapterId: pageChapterId ?? undefined,
        });
      }
    }
  }, [
    pageNovelId,
    pageChapterId,
    attachedNovelId,
    attachedChapterId,
    activeConversationId,
    setAttachedContext,
  ]);

  // Keyboard shortcut: Cmd+. to toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useChatPanel.getState().toggle();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /** Core: send a user message in a conversation and stream the response. */
  const sendAndStream = useCallback(
    async (
      convoId: string,
      userText: string,
      images?: ChatImage[],
      files?: ChatFile[],
    ) => {
      if (!selectedProvider || !selectedModelId) return;

      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      let assistantMsgId: string | null = null;
      type HistoryMsg =
        | { role: "system"; content: string }
        | {
            role: "user";
            content:
              | string
              | Array<
                  | { type: "text"; text: string }
                  | {
                      type: "image";
                      image: string | Uint8Array;
                      mimeType?: string;
                    }
                >;
          }
        | { role: "assistant"; content: string };
      let history: HistoryMsg[] = [];
      let latestStreamedContent = "";

      try {
        // Save user message
        await addMessage({
          conversationId: convoId,
          role: "user",
          content: userText,
          ...(images && images.length > 0 ? { images } : {}),
          ...(files && files.length > 0 ? { files } : {}),
        });

        // Create placeholder assistant message
        assistantMsgId = await addMessage({
          conversationId: convoId,
          role: "assistant",
          content: "",
        });
        setStreamingMsgId(assistantMsgId);
        setStreamingContent("");
        setStreamingReasoning("");
        setStreamingParts([]);

        // Build conversation history from DB
        const currentMessages = await import("@/lib/db").then((mod) =>
          mod.db.conversationMessages
            .where("conversationId")
            .equals(convoId)
            .sortBy("createdAt"),
        );

        // Build system prompt with optional novel context
        const { attachedNovelId: ctxNovelId, attachedChapterId: ctxChapterId } =
          useChatPanel.getState();
        let contextEnhancedPrompt = systemPrompt;
        if (ctxNovelId) {
          const { buildNovelContext } = await import("@/lib/ai/novel-context");
          const novelContext = await buildNovelContext(
            ctxNovelId,
            ctxChapterId,
          );
          if (novelContext) {
            contextEnhancedPrompt = systemPrompt
              ? `${systemPrompt}\n\n${novelContext}`
              : novelContext;
          }
        }

        history = [
          {
            role: "system" as const,
            content: contextEnhancedPrompt,
          },
          ...currentMessages
            .filter((m) => m.id !== assistantMsgId)
            .map((m) => {
              // Build file content suffix for user messages
              const filesSuffix =
                m.role === "user" && m.files && m.files.length > 0
                  ? m.files
                      .map(
                        (f) =>
                          `\n\n<file name="${f.name}">\n${f.content}\n</file>`,
                      )
                      .join("")
                  : "";

              if (m.role === "user" && m.images && m.images.length > 0) {
                return {
                  role: "user" as const,
                  content: [
                    ...(m.content || filesSuffix
                      ? [
                          {
                            type: "text" as const,
                            text: (m.content || "") + filesSuffix,
                          },
                        ]
                      : []),
                    ...m.images.map((img) => ({
                      type: "image" as const,
                      image: dataUrlToUint8Array(img.dataUrl),
                      mimeType: img.mimeType,
                    })),
                  ],
                };
              }
              return {
                role: m.role as "user" | "assistant",
                content: m.content + filesSuffix,
              };
            }),
        ];

        // Conditionally include tools when a novel is attached
        let tools: Parameters<typeof streamText>[0]["tools"] = undefined;
        if (ctxNovelId) {
          const { createChatTools } = await import("@/lib/ai/chat-tools");
          tools = createChatTools(ctxNovelId);
        }

        const result = streamText({
          model: await getModel(selectedProvider, selectedModelId),
          messages: history,
          temperature,
          abortSignal: controller.signal,
          maxOutputTokens: 25000,
          ...(tools ? { tools, stopWhen: stepCountIs(maxToolSteps) } : {}),
        });

        let rawContent = "";
        let apiReasoning = "";
        let finishReason: string | undefined;
        let streamError: unknown = null;

        // Track ordered parts using parsed-content offsets.
        // We split the parsed (thinking-stripped) content at step boundaries
        // so parts always contain clean text. Tool calls are buffered until
        // finish-step to avoid splitting mid-word.
        type ToolCall = {
          toolCallId: string;
          toolName: string;
          args: Record<string, unknown>;
          result?: unknown;
        };
        type Part =
          | { type: "text"; content: string }
          | { type: "tool-calls"; toolCalls: ToolCall[] };
        const committedParts: Part[] = [];
        let lastCommittedParsedLen = 0;
        let pendingToolCalls: ToolCall[] = [];
        let lastParsedContent = "";

        const buildSnapshot = (): Part[] => {
          const snapshot: Part[] = committedParts.map((p) =>
            p.type === "tool-calls"
              ? { ...p, toolCalls: p.toolCalls.map((tc) => ({ ...tc })) }
              : { ...p },
          );
          // Append pending tool calls (shown during tool execution)
          if (pendingToolCalls.length > 0) {
            snapshot.push({
              type: "tool-calls",
              toolCalls: pendingToolCalls.map((tc) => ({ ...tc })),
            });
          }
          // Append in-progress text from the current step
          const trailingText = lastParsedContent.slice(lastCommittedParsedLen);
          if (trailingText) {
            snapshot.push({ type: "text", content: trailingText });
          }
          return snapshot;
        };

        const flushParts = () => setStreamingParts(buildSnapshot());

        for await (const part of result.fullStream) {
          if (part.type === "reasoning-delta") {
            apiReasoning += part.text;
          } else if (part.type === "text-delta") {
            rawContent += part.text;
          } else if (part.type === "tool-call") {
            const input = "input" in part ? part.input : undefined;
            pendingToolCalls.push({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args:
                input != null && typeof input === "object"
                  ? (input as Record<string, unknown>)
                  : {},
            });
            flushParts();
            continue;
          } else if (part.type === "tool-result") {
            // Update in pending or already-committed parts
            const allToolCalls = [
              ...pendingToolCalls,
              ...committedParts
                .filter(
                  (p): p is { type: "tool-calls"; toolCalls: ToolCall[] } =>
                    p.type === "tool-calls",
                )
                .flatMap((p) => p.toolCalls),
            ];
            const tc = allToolCalls.find(
              (t) => t.toolCallId === part.toolCallId,
            );
            if (tc) {
              tc.result = "output" in part ? part.output : undefined;
            }
            flushParts();
            continue;
          } else if (part.type === "finish-step") {
            finishReason = part.finishReason;
            // Re-parse to ensure reasoning state is up-to-date at step boundary
            const stepParsed = parseThinkingTags(rawContent);
            lastParsedContent = stepParsed.content;
            const stepReasoning = apiReasoning
              ? apiReasoning +
                (stepParsed.reasoning ? "\n\n" + stepParsed.reasoning : "")
              : stepParsed.reasoning;
            if (stepReasoning) setStreamingReasoning(stepReasoning);
            setStreamingContent(stepParsed.content);
            latestStreamedContent = stepParsed.content;
            // Commit completed step using parsed content boundaries
            const stepText = lastParsedContent.slice(lastCommittedParsedLen);
            if (stepText) {
              committedParts.push({ type: "text", content: stepText });
            }
            if (pendingToolCalls.length > 0) {
              committedParts.push({
                type: "tool-calls",
                toolCalls: pendingToolCalls,
              });
              pendingToolCalls = [];
            }
            lastCommittedParsedLen = lastParsedContent.length;
            flushParts();
            continue;
          } else if (part.type === "error") {
            streamError = part.error;
            continue;
          } else {
            continue;
          }

          // Parse <think>/<thinking> tags from content stream
          const parsed = parseThinkingTags(rawContent);
          lastParsedContent = parsed.content;
          const combinedReasoning = apiReasoning
            ? apiReasoning + (parsed.reasoning ? "\n\n" + parsed.reasoning : "")
            : parsed.reasoning;

          setStreamingReasoning(combinedReasoning);
          setStreamingContent(parsed.content);
          latestStreamedContent = parsed.content;
          flushParts();
        }

        // If stream emitted an error part (network failures, API errors, etc.),
        // throw so the catch block can format it properly
        if (streamError) {
          throw streamError;
        }

        // If AI was stopped at tool call limit (still wanted more tool calls),
        // make one follow-up call without tools so it can summarize its findings.
        if (finishReason === "tool-calls" && !controller.signal.aborted) {
          try {
            const { messages: responseMessages } = await result.response;
            const followUpHistory = [
              ...history,
              ...responseMessages,
              {
                role: "user" as const,
                content:
                  "[System: You have reached the maximum number of tool calls allowed. Based on all the information you have gathered so far, please provide your complete final answer now.]",
              },
            ];

            const followUpStream = streamText({
              model: await getModel(selectedProvider, selectedModelId),
              messages: followUpHistory,
              temperature,
              abortSignal: controller.signal,
            });

            for await (const part of followUpStream.fullStream) {
              if (part.type === "reasoning-delta") {
                apiReasoning += part.text;
              } else if (part.type === "text-delta") {
                rawContent += part.text;
              } else if (part.type === "finish-step") {
                finishReason = part.finishReason;
                const stepParsed = parseThinkingTags(rawContent);
                lastParsedContent = stepParsed.content;
                const stepReasoning = apiReasoning
                  ? apiReasoning +
                    (stepParsed.reasoning ? "\n\n" + stepParsed.reasoning : "")
                  : stepParsed.reasoning;
                if (stepReasoning) setStreamingReasoning(stepReasoning);
                setStreamingContent(stepParsed.content);
                latestStreamedContent = stepParsed.content;
                const stepText = lastParsedContent.slice(
                  lastCommittedParsedLen,
                );
                if (stepText) {
                  committedParts.push({ type: "text", content: stepText });
                }
                lastCommittedParsedLen = lastParsedContent.length;
                flushParts();
                continue;
              } else if (part.type === "error") {
                break;
              } else {
                continue;
              }

              const parsed = parseThinkingTags(rawContent);
              lastParsedContent = parsed.content;
              const combinedReasoning = apiReasoning
                ? apiReasoning +
                  (parsed.reasoning ? "\n\n" + parsed.reasoning : "")
                : parsed.reasoning;
              setStreamingReasoning(combinedReasoning);
              setStreamingContent(parsed.content);
              latestStreamedContent = parsed.content;
              flushParts();
            }
          } catch {
            // Follow-up failed silently — keep whatever content was already streamed
          }
        }

        // Final parse
        const finalParsed = parseThinkingTags(rawContent);
        const finalReasoning = apiReasoning
          ? apiReasoning +
            (finalParsed.reasoning ? "\n\n" + finalParsed.reasoning : "")
          : finalParsed.reasoning;

        // Empty response — provide specific message based on finish reason
        let finalContent = finalParsed.content;
        if (!finalContent.trim()) {
          if (finishReason === "content-filter") {
            finalContent =
              "<!-- error -->\n**Nội dung bị chặn** — Bộ lọc an toàn của nhà cung cấp AI đã chặn phản hồi này. Hãy thử chỉnh sửa **Chỉ thị chung**, **system prompt** của cuộc hội thoại, hoặc **đổi mô hình AI** khác.";
          } else if (finishReason === "length") {
            finalContent =
              "<!-- error -->\n**Vượt quá giới hạn token** — Phản hồi đã bị cắt do vượt quá giới hạn token của mô hình. Hãy thử rút ngắn lịch sử hội thoại hoặc sử dụng mô hình có context lớn hơn.";
          } else if (finishReason === "error") {
            finalContent =
              "<!-- error -->\n**Lỗi nhà cung cấp** — Nhà cung cấp AI gặp lỗi nội bộ khi xử lý yêu cầu. Hãy thử lại sau hoặc đổi mô hình AI khác.";
          } else {
            finalContent =
              "<!-- error -->\n**Phản hồi trống** — Nhà cung cấp AI trả về nội dung trống (finish reason: `" +
              (finishReason || "unknown") +
              "`). Hãy thử chỉnh sửa **Chỉ thị chung**, **system prompt** của cuộc hội thoại, hoặc **đổi mô hình AI** khác.";
          }

          // Store trace for empty/error responses too
          if (assistantMsgId) {
            const emptyErr = new Error(
              `Empty response (finish reason: ${finishReason || "unknown"})`,
            );
            const trace = buildErrorTrace(emptyErr, {
              module: "chat",
              provider: {
                name: selectedProvider.name,
                type: selectedProvider.providerType ?? "openai-compatible",
                baseUrl: selectedProvider.baseUrl,
              },
              modelId: selectedModelId,
              request: {
                systemPrompt,
                messageCount: history.length,
                temperature,
                lastUserMessage: userText,
              },
            });
            storeErrorTrace(assistantMsgId, trace);
          }
        }

        // Persist final content, reasoning, and ordered parts
        await updateMessage(assistantMsgId, {
          content: finalContent,
          ...(finalReasoning ? { reasoning: finalReasoning } : {}),
          ...(committedParts.length > 0 ? { parts: committedParts } : {}),
        });

        return { content: finalContent, convoId };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (assistantMsgId) {
          let errorContent: string;

          if (APICallError.isInstance(err)) {
            const status = err.statusCode;
            const body = err.responseBody;

            // Extract human-readable message from response body.
            // Some providers nest JSON inside error.message (upstream proxies),
            // so we recurse one level to find a plain-text message.
            let detail = "";
            let bodyJson = "";
            if (body) {
              try {
                const parsed = JSON.parse(body);
                bodyJson = JSON.stringify(parsed, null, 2);

                const extractMessage = (obj: unknown): string => {
                  if (!obj || typeof obj !== "object") return "";
                  const o = obj as Record<string, unknown>;
                  const msg =
                    (typeof o?.error === "object"
                      ? (o.error as Record<string, unknown>)?.message
                      : undefined) ??
                    o?.message ??
                    (typeof o?.error === "string" ? o.error : "");
                  if (typeof msg !== "string") return "";
                  // If the message itself is JSON, try to extract from it
                  const trimmed = msg.trim();
                  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    try {
                      return extractMessage(JSON.parse(trimmed));
                    } catch {
                      /* not JSON, use as-is */
                    }
                  }
                  return msg;
                };

                detail = extractMessage(parsed);
              } catch {
                detail = body.length > 200 ? body.slice(0, 200) + "..." : body;
              }
            }

            const responseBlock = bodyJson
              ? `\n\n\`\`\`json\n${bodyJson}\n\`\`\``
              : "";

            if (status === 401 || status === 403) {
              errorContent = `<!-- error -->\n**Lỗi xác thực (${status})** — ${detail || "API key không hợp lệ hoặc không có quyền truy cập."}\n\nHãy kiểm tra lại API key trong **Cài đặt nhà cung cấp AI**.${responseBlock}`;
            } else if (status === 429) {
              errorContent = `<!-- error -->\n**Vượt quá giới hạn (429)** — ${detail || "Đã vượt quá rate limit hoặc hết quota."}\n\nHãy chờ một lát rồi thử lại, hoặc kiểm tra quota tài khoản.${responseBlock}`;
            } else if (status === 404) {
              errorContent = `<!-- error -->\n**Không tìm thấy (404)** — ${detail || "Mô hình hoặc endpoint không tồn tại."}\n\nHãy kiểm tra lại tên mô hình và URL của nhà cung cấp.${responseBlock}`;
            } else if (status && status >= 500) {
              errorContent = `<!-- error -->\n**Lỗi server (${status})** — ${detail || "Nhà cung cấp AI gặp sự cố nội bộ."}\n\nHãy thử lại sau.${responseBlock}`;
            } else {
              errorContent = `<!-- error -->\n**Lỗi API${status ? ` (${status})` : ""}** — ${detail || "Yêu cầu không hợp lệ."}${responseBlock}`;
            }
          } else {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const cause =
              err instanceof Error && err.cause instanceof Error
                ? err.cause.message
                : "";
            errorContent = `<!-- error -->\n**Lỗi kết nối** — ${errorMsg}${cause ? `\n\n> ${cause}` : ""}`;
          }

          // Build and store error trace for debug download
          const trace = buildErrorTrace(err, {
            module: "chat",
            provider: {
              name: selectedProvider.name,
              type: selectedProvider.providerType ?? "openai-compatible",
              baseUrl: selectedProvider.baseUrl,
            },
            modelId: selectedModelId,
            request: {
              systemPrompt,
              messageCount: history.length,
              temperature,
              lastUserMessage: userText,
            },
          });
          storeErrorTrace(assistantMsgId, trace);

          await updateMessage(assistantMsgId, {
            content: latestStreamedContent || errorContent,
          });
        }
      } finally {
        setIsStreaming(false);
        setStreamingMsgId(null);
        setStreamingContent("");
        setStreamingReasoning("");
        setStreamingParts([]);
        abortRef.current = null;
      }
    },
    [
      selectedProvider,
      selectedModelId,
      systemPrompt,
      temperature,
      maxToolSteps,
    ],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (
      (!text && pendingImages.length === 0) ||
      isStreaming ||
      !selectedProvider ||
      !selectedModelId
    )
      return;

    setInput("");
    const imagesToSend =
      pendingImages.length > 0 ? [...pendingImages] : undefined;
    const filesToSend = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
    setPendingImages([]);
    setPendingFiles([]);

    // Reuse active conversation, or auto-create one if none exists
    let convoId = activeConversationId;
    if (!convoId) {
      const { pageNovelId, pageChapterId } = useChatPanel.getState();
      convoId = await createConversation({
        title: "Cuộc trò chuyện mới",
        providerId: selectedProviderId,
        modelId: selectedModelId,
        novelId: pageNovelId ?? undefined,
        chapterId: pageNovelId ? (pageChapterId ?? undefined) : undefined,
      });
      setActiveConversation(convoId);
      setAttachedContext(pageNovelId, pageNovelId ? pageChapterId : null);
    }

    const isFirstMessage = !dbMessages || dbMessages.length === 0;
    const result = await sendAndStream(
      convoId,
      text,
      imagesToSend,
      filesToSend,
    );

    // Auto-title from first assistant reply
    if (isFirstMessage && result?.content) {
      const shortTitle =
        result.content.length > 60
          ? result.content.slice(0, 57) + "..."
          : result.content;
      await updateConversation(convoId, {
        title: shortTitle || text.slice(0, 50),
      });
    }
  }, [
    input,
    pendingImages,
    pendingFiles,
    isStreaming,
    selectedProvider,
    selectedModelId,
    selectedProviderId,
    activeConversationId,
    dbMessages,
    sendAndStream,
    setActiveConversation,
    setAttachedContext,
  ]);

  /** Edit a user message: delete it and everything after, then resend with new text. */
  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (isStreaming || !activeConversationId) return;
      await deleteMessagesFrom(activeConversationId, messageId);
      await sendAndStream(activeConversationId, newContent);
    },
    [isStreaming, activeConversationId, sendAndStream],
  );

  /** Rerun a user message: delete it and its response, then resend the same text and images. */
  const handleRerunMessage = useCallback(
    async (messageId: string, content: string, images?: ChatImage[]) => {
      if (isStreaming || !activeConversationId) return;
      await deleteMessagesFrom(activeConversationId, messageId);
      await sendAndStream(activeConversationId, content, images);
    },
    [isStreaming, activeConversationId, sendAndStream],
  );

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleNewConversation() {
    if (isStreaming) handleStop();
    const { pageNovelId, pageChapterId } = useChatPanel.getState();
    const convoId = await createConversation({
      title: "Cuộc trò chuyện mới",
      providerId: selectedProviderId,
      modelId: selectedModelId,
      novelId: pageNovelId ?? undefined,
      chapterId: pageNovelId ? (pageChapterId ?? undefined) : undefined,
    });
    setActiveConversation(convoId);
    // Set attachedContext immediately so the first message has the correct context.
    // (syncedConvoIdRef effect runs async after render — too late for sendAndStream)
    setAttachedContext(pageNovelId, pageNovelId ? pageChapterId : null);
  }

  async function handleImageFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (!imageFiles.length) return;
    const compressed = await Promise.all(imageFiles.map(compressImage));
    setPendingImages((prev) => [...prev, ...compressed]);
    inputRef.current?.focus();
  }

  async function handleTextFiles(files: FileList | File[]) {
    const textFiles = Array.from(files).filter(isSupportedFile);
    if (!textFiles.length) return;
    const results = await Promise.allSettled(textFiles.map(readFileAsChat));
    const successful = results
      .filter(
        (r): r is PromiseFulfilledResult<ChatFile> => r.status === "fulfilled",
      )
      .map((r) => r.value);
    if (successful.length) {
      setPendingFiles((prev) => [...prev, ...successful]);
      inputRef.current?.focus();
    }
  }

  async function handleDroppedFiles(files: FileList | File[]) {
    const all = Array.from(files);
    const images = all.filter((f) => f.type.startsWith("image/"));
    const textFiles = all.filter(
      (f) => !f.type.startsWith("image/") && isSupportedFile(f),
    );
    if (images.length) await handleImageFiles(images);
    if (textFiles.length) await handleTextFiles(textFiles);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasProvider = useAdminModel || (providers && providers.length > 0);
  const hasModels = useAdminModel || (models && models.length > 0);
  const canSend =
    (!!input.trim() || pendingImages.length > 0 || pendingFiles.length > 0) &&
    hasProvider &&
    hasModels &&
    !isStreaming;

  // Merge DB messages with in-progress streaming
  const displayMessages = (dbMessages ?? []).map((m) =>
    m.id === streamingMsgId
      ? {
          ...m,
          ...(streamingContent ? { content: streamingContent } : {}),
          ...(streamingReasoning ? { reasoning: streamingReasoning } : {}),
          ...(streamingParts.length > 0 ? { parts: streamingParts } : {}),
        }
      : m,
  );

  const panelContent = (
    <>
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-2.5">
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[13px] font-medium tracking-tight">
            Trò chuyện AI
          </span>
        </div>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleNewConversation}
            title="Cuộc trò chuyện mới"
          >
            <PlusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setHistoryOpen(true)}
            title="Lịch sử trò chuyện"
          >
            <HistoryIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSettingsOpen(true)}
            title="Cài đặt trò chuyện"
          >
            <SettingsIcon />
          </Button>
          <div className="mx-1 h-3.5 w-px bg-border/60" />
          <Button variant="ghost" size="icon-sm" onClick={close}>
            <XIcon />
          </Button>
        </div>
      </div>

      {historyOpen && (
        <ChatHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          conversations={conversations ?? []}
          activeConversationId={activeConversationId}
          onSelect={(id) => {
            setActiveConversation(id);
            setHistoryOpen(false);
          }}
          onDelete={async (id) => {
            await deleteConversation(id);
            if (activeConversationId === id) setActiveConversation(null);
          }}
        />
      )}

      {settingsOpen && (
        <ChatSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          providers={providers ?? []}
          models={models ?? []}
          selectedProviderId={selectedProviderId}
          onProviderChange={(id) => {
            updateChatSettings({ providerId: id, modelId: "" });
            if (activeConversationId) {
              updateConversation(activeConversationId, {
                providerId: id,
                modelId: "",
              });
            }
          }}
          selectedModelId={selectedModelId}
          onModelChange={(id) => {
            updateChatSettings({ modelId: id });
            if (activeConversationId) {
              updateConversation(activeConversationId, { modelId: id });
            }
          }}
          systemPrompt={chatSettings.systemPrompt ?? ""}
          onSystemPromptChange={(p) => updateChatSettings({ systemPrompt: p })}
          temperature={temperature}
          onTemperatureChange={(t) => updateChatSettings({ temperature: t })}
          maxToolSteps={maxToolSteps}
          onMaxToolStepsChange={(s) => updateChatSettings({ maxToolSteps: s })}
        />
      )}

      {/* Messages */}
      <StickToBottom
        className="relative min-h-0 flex-1"
        resize="smooth"
        initial="instant"
      >
        <StickToBottom.Content className="flex flex-col gap-5 px-4 py-5">
          {!hasProvider ? (
            <Empty className="my-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BotIcon />
                </EmptyMedia>
                <EmptyTitle>Chưa cấu hình nhà cung cấp AI</EmptyTitle>
                <EmptyDescription>
                  Thêm nhà cung cấp trong Cài đặt để bắt đầu trò chuyện.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : displayMessages.length === 0 ? (
            <Empty className="my-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {useAdminModel ? <CrownIcon className="text-yellow-500" /> : <BotIcon />}
                </EmptyMedia>
                <EmptyTitle>{useAdminModel ? "Trợ lý AI — Model Admin" : "Trợ lý sáng tác"}</EmptyTitle>
                <EmptyDescription>
                  {useAdminModel
                    ? `Bạn đang sử dụng model admin. Còn ${profile?.admin_model_quota ?? 0} lượt. Hãy đặt câu hỏi hoặc nhờ hỗ trợ sáng tác.`
                    : "Đặt câu hỏi, brainstorm ý tưởng, hoặc nhận trợ giúp với bài viết của bạn."
                  }
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            displayMessages
              .filter((m) => m.role !== "system")
              .map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={isStreaming && msg.id === streamingMsgId}
                  onEdit={
                    msg.role === "user" && !isStreaming
                      ? (newContent) => handleEditMessage(msg.id, newContent)
                      : undefined
                  }
                  onRerun={
                    msg.role === "user" && !isStreaming
                      ? () =>
                          handleRerunMessage(msg.id, msg.content, msg.images)
                      : undefined
                  }
                />
              ))
          )}
          {isStreaming &&
            !streamingContent &&
            !streamingReasoning &&
            streamingParts.length === 0 && (
              <div className="flex items-center gap-2 pl-1 text-[12px] text-muted-foreground/60">
                <LoaderIcon className="size-3 animate-spin" />
                <span>Đang kết nối...</span>
              </div>
            )}
        </StickToBottom.Content>
        <ScrollToBottom />
      </StickToBottom>

      <NovelContextBadge />

      {/* Composer */}
      <div className="shrink-0 border-t bg-card/50 px-3 pb-3 pt-2.5">
        <div
          className={cn(
            "overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-150",
            "focus-within:border-ring/60 focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/10%)]",
            isDragging &&
              "border-ring/60 shadow-[0_0_0_3px_hsl(var(--ring)/10%)]",
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDragging(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length) {
              handleDroppedFiles(e.dataTransfer.files);
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={`image/*,${FILE_INPUT_ACCEPT}`}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                handleDroppedFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />

          {/* Previews: images + file chips */}
          {(pendingImages.length > 0 || pendingFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {pendingImages.map((img, i) => (
                <div key={`img-${i}`} className="relative shrink-0">
                  <img
                    src={img.dataUrl}
                    alt={img.name ?? `Ảnh ${i + 1}`}
                    className="h-14 w-14 rounded-xl border border-border/50 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPendingImages((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="absolute -right-1 -top-1 flex size-[18px] items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-opacity hover:opacity-75"
                  >
                    <XIcon size={9} />
                  </button>
                </div>
              ))}
              {pendingFiles.map((file, i) => (
                <div
                  key={`file-${i}`}
                  className="relative flex h-14 max-w-[140px] shrink-0 items-center gap-2 rounded-xl border border-border/50 bg-muted/50 px-2.5"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[11px] font-medium leading-tight">
                      {file.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingFiles((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="absolute -right-1 -top-1 flex size-[18px] items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-opacity hover:opacity-75"
                  >
                    <XIcon size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Drag overlay hint */}
          {isDragging && (
            <div className="pointer-events-none px-4 pb-1 pt-2 text-[11px] text-muted-foreground/60">
              Thả tệp để đính kèm...
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData.items);
              const imageItems = items.filter((item) =>
                item.type.startsWith("image/"),
              );
              if (imageItems.length > 0) {
                e.preventDefault();
                const pastedImages = imageItems
                  .map((item) => item.getAsFile())
                  .filter(Boolean) as File[];
                handleImageFiles(pastedImages);
                return;
              }
              // Handle pasted text files
              const fileItems = items.filter((item) => item.kind === "file");
              const pastedFiles = fileItems
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null && isSupportedFile(f));
              if (pastedFiles.length > 0) {
                e.preventDefault();
                handleTextFiles(pastedFiles);
              }
            }}
            placeholder={
              hasProvider
                ? "Hỏi trợ lý sáng tác..."
                : "Vui lòng cấu hình nhà cung cấp trước"
            }
            disabled={!hasProvider || !hasModels}
            rows={1}
            className="field-sizing-content max-h-36 min-h-11 w-full resize-none bg-transparent px-4 pb-2 pt-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50 disabled:opacity-40"
          />

          {/* Action bar */}
          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            {/* Left: attach + model pill */}
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <AttachMenuButton
                onFileClick={() => fileInputRef.current?.click()}
                disabled={!hasProvider || !hasModels || isStreaming}
              />
              {useAdminModel ? (
                <div className="flex items-center gap-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1">
                  <CrownIcon className="size-3 text-yellow-500" />
                  <span className="text-[11px] font-medium text-yellow-600 dark:text-yellow-400">
                    Model Admin ({profile?.admin_model_quota ?? 0} lượt)
                  </span>
                </div>
              ) : (
                <ModelSelectorButton
                  providers={providers ?? []}
                  models={models}
                  selectedProviderId={selectedProviderId}
                  selectedModelId={selectedModelId}
                  onProviderChange={(id) => {
                    updateChatSettings({ providerId: id, modelId: "" });
                    if (activeConversationId) {
                      updateConversation(activeConversationId, {
                        providerId: id,
                        modelId: "",
                      });
                    }
                  }}
                  onModelChange={(id) => {
                    updateChatSettings({ modelId: id });
                    if (activeConversationId) {
                      updateConversation(activeConversationId, { modelId: id });
                    }
                  }}
                  disabled={isStreaming}
                />
              )}
            </div>

            {/* Right: send / stop */}
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                title="Dừng tạo"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-75"
              >
                <SquareIcon size={10} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                title="Gửi tin nhắn"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-20"
              >
                <ArrowUpIcon size={14} />
              </button>
            )}
          </div>
        </div>

        {/* <p className="mt-1.5 text-center text-[10px] text-muted-foreground/35">
          <kbd className="rounded bg-muted px-1 py-px font-mono text-[9px]">
            Shift+Enter
          </kbd>{" "}
          xuống dòng
        </p> */}
      </div>
    </>
  );

  // Mobile: Sheet drawer
  if (isMobile) {
    return (
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-screen! max-w-[100vw] bg-card p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Trò chuyện AI</SheetTitle>
            <SheetDescription>Bảng trò chuyện AI</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{panelContent}</div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: normal panel when no tool active, floating overlay when tool is open
  if (toolActive) {
    return (
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-20 hidden h-svh w-[400px] border-l bg-card shadow-lg transition-[right] duration-200 ease-linear md:flex",
          !isOpen && "right-[calc(400px*-1)]",
        )}
      >
        <div className="flex size-full flex-col">{panelContent}</div>
      </div>
    );
  }

  // No tool active — normal layout panel with gap spacer
  return (
    <div className="hidden md:block">
      <div
        className={cn(
          "relative bg-transparent transition-[width] duration-200 ease-linear",
          isOpen ? "w-[360px]" : "w-0",
        )}
      />
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-10 hidden h-svh w-[360px] border-l bg-card transition-[right] duration-200 ease-linear md:flex",
          !isOpen && "right-[calc(360px*-1)]",
        )}
      >
        <div className="flex size-full flex-col">{panelContent}</div>
      </div>
    </div>
  );
}
