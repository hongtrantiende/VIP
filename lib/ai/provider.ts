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

function getPlainHeaders(headers: any): Record<string, string> {
  const plain: Record<string, string> = {};
  if (!headers) return plain;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      plain[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      plain[key] = value;
    }
  } else if (typeof headers === "object") {
    Object.assign(plain, headers);
  }
  return plain;
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
        baseURL: "https://dummy.local/api/ai/admin-proxy",
        apiKey: "proxy", // not used by proxy route but required by SDK
        supportsStructuredOutputs: false,
        fetch: async (url, options) => {
          // Route through the dedicated admin proxy
          const plainHeaders = getPlainHeaders(options?.headers);
          let proxyUrl = "/api/ai/admin-proxy";
          if (typeof window !== "undefined") {
            proxyUrl = window.location.origin + "/api/ai/admin-proxy";
          } else {
            const nextPublicUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
            if (nextPublicUrl) {
              proxyUrl = nextPublicUrl.replace(/\/+$/, "") + "/api/ai/admin-proxy";
            }
          }
          return fetch(proxyUrl, {
            ...options,
            headers: plainHeaders,
          });
        },
      }).chatModel(modelId),
    );
  }

  const type: ProviderType = provider.providerType ?? "openai-compatible";

  const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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

    const plainHeaders = getPlainHeaders(init?.headers);
    let proxyUrl = "/api/ai-proxy";
    if (typeof window !== "undefined") {
      proxyUrl = window.location.origin + "/api/ai-proxy";
    } else {
      const nextPublicUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      if (nextPublicUrl) {
        proxyUrl = nextPublicUrl.replace(/\/+$/, "") + "/api/ai-proxy";
      }
    }

    // Route through server-side proxy to bypass CORS
    return fetch(proxyUrl, {
      ...init,
      headers: {
        ...plainHeaders,
        "x-target-url": input.toString(),
        ...(authHeader ? { "x-supabase-auth": authHeader } : {}),
      },
    });
  };

  switch (type) {
    case "openai":
      return createOpenAI({ apiKey: provider.apiKey, fetch: proxyFetch })(modelId);

    case "anthropic":
      return createAnthropic({ apiKey: provider.apiKey, fetch: proxyFetch })(modelId);

    case "google":
      return createGoogleGenerativeAI({ apiKey: provider.apiKey, fetch: proxyFetch })(modelId, {
        safetySettings: [
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ]
      });

    case "groq":
      return createGroq({ apiKey: provider.apiKey, fetch: proxyFetch })(modelId);

    case "mistral":
      return createMistral({ apiKey: provider.apiKey, fetch: proxyFetch })(modelId);

    case "xai":
      return createXai({ apiKey: provider.apiKey, fetch: proxyFetch })(modelId);

    case "openrouter":
      return withJsonExtraction(
        createOpenAICompatible({
          name: "openrouter",
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: provider.apiKey,
          supportsStructuredOutputs: false,
          fetch: proxyFetch,
        }).chatModel(modelId),
      );

    case "openai-compatible":
    default:
      return withJsonExtraction(
        createOpenAICompatible({
          name: provider.name || "custom",
          baseURL: provider.baseUrl.replace(/\/+$/, ""),
          apiKey: provider.apiKey,
          supportsStructuredOutputs: false,
          fetch: proxyFetch,
        }).chatModel(modelId),
      );
  }
}

