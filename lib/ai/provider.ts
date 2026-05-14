import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  wrapLanguageModel,
  extractJsonMiddleware,
  type LanguageModel,
} from "ai";
import type { AIProvider, ProviderType } from "@/lib/db";

/**
 * Wrap a model with extractJsonMiddleware so that when the model
 * returns JSON wrapped in markdown fences or extra text,
 * the SDK can still extract and parse the JSON correctly.
 */
function withJsonExtraction(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    middleware: extractJsonMiddleware(),
  });
}

/**
 * Create a LanguageModel for a specific provider + model ID.
 * Dispatches to the appropriate native SDK based on providerType,
 * falling back to openai-compatible for unknown types.
 *
 * For openai-compatible and openrouter providers, the model is wrapped
 * with extractJsonMiddleware to handle providers that return JSON
 * inside markdown fences or with extra text.
 */
export async function getModel(
  provider: AIProvider,
  modelId: string,
): Promise<LanguageModel> {
  // 0. Special case for Admin-provided models
  if (provider.id === "admin-provider") {
    return withJsonExtraction(
      createOpenAICompatible({
        name: "Admin Model",
        baseURL: "/api/ai/admin-proxy",
        apiKey: "proxy", // not used by proxy route but required by SDK
        supportsStructuredOutputs: false,
        fetch: async (url, options) => {
          // Route through the dedicated admin proxy
          return fetch("/api/ai/admin-proxy", {
            ...options,
            headers: {
              ...options?.headers,
            },
          });
        },
      }).chatModel(modelId),
    );
  }

  const type: ProviderType = provider.providerType ?? "openai-compatible";

  switch (type) {
    case "openai":
      return createOpenAI({ apiKey: provider.apiKey })(modelId);

    case "anthropic":
      return createAnthropic({ apiKey: provider.apiKey })(modelId);

    case "google":
      return createGoogleGenerativeAI({ apiKey: provider.apiKey })(modelId);

    case "groq":
      return createGroq({ apiKey: provider.apiKey })(modelId);

    case "mistral":
      return createMistral({ apiKey: provider.apiKey })(modelId);

    case "xai":
      return createXai({ apiKey: provider.apiKey })(modelId);

    case "openrouter":
      return withJsonExtraction(
        createOpenAICompatible({
          name: "openrouter",
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: provider.apiKey,
          supportsStructuredOutputs: false,
        }).chatModel(modelId),
      );

    case "webgpu": {
      const { createWebGPUModel } = await import("./webgpu-provider");
      return createWebGPUModel(modelId);
    }

    case "openai-compatible":
    default:
      return withJsonExtraction(
        createOpenAICompatible({
          name: provider.name || "custom",
          baseURL: provider.baseUrl.replace(/\/+$/, ""),
          apiKey: provider.apiKey,
          supportsStructuredOutputs: false,
          fetch: async (url, options) => {
            let authHeader = "";
            try {
              const { createClient } = await import("@/lib/supabase/client");
              const supabase = createClient();
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.access_token) {
                authHeader = `Bearer ${session.access_token}`;
              }
            } catch (e) {
              console.error("Failed to get supabase session", e);
            }

            // Route through server-side proxy to bypass CORS
            return fetch("/api/ai-proxy", {
              ...options,
              headers: {
                ...options?.headers,
                "x-target-url": url.toString(),
                ...(authHeader ? { "x-supabase-auth": authHeader } : {}),
              },
            });
          },
        }).chatModel(modelId),
      );
  }
}
