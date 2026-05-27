import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createClient } from "@/lib/supabase/client";
import type { AIProvider } from "@/lib/db";

// Tiện ích mock fetch proxy (giống trong provider.ts) để bypass CORS nếu gọi từ client
const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  let authHeader = "";
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      authHeader = `Bearer ${session.access_token}`;
    }
  } catch (e) {
    console.error("Failed to get supabase session", e);
  }

  const plainHeaders: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => { plainHeaders[key] = value; });
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) { plainHeaders[key] = value; }
    } else {
      Object.assign(plainHeaders, init.headers);
    }
  }

  let proxyUrl = "/api/ai-proxy";
  if (typeof window !== "undefined") {
    proxyUrl = window.location.origin + "/api/ai-proxy";
  } else {
    const nextPublicUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
    if (nextPublicUrl) {
      proxyUrl = nextPublicUrl.replace(/\/+$/, "") + "/api/ai-proxy";
    }
  }

  return fetch(proxyUrl, {
    ...init,
    headers: {
      ...plainHeaders,
      "x-target-url": input.toString(),
      ...(authHeader ? { "x-supabase-auth": authHeader } : {}),
    },
  });
};

function getEmbeddingModel(provider: AIProvider, modelId: string) {
  const type = provider.providerType ?? "openai-compatible";
  
  if (type === "openai") {
    return createOpenAI({ apiKey: provider.apiKey, fetch: proxyFetch }).textEmbeddingModel(modelId);
  }
  
  // Default to compatible
  return createOpenAICompatible({
    name: provider.name || "custom",
    baseURL: provider.baseUrl.replace(/\/+$/, ""),
    apiKey: provider.apiKey,
    fetch: proxyFetch,
  }).textEmbeddingModel(modelId);
}

/**
 * Tách một văn bản dài thành các chunk nhỏ để nhúng (khoảng 1000 ký tự mỗi chunk)
 */
function chunkText(text: string, maxChunkLength: number = 1000): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  
  let currentChunk = "";
  for (const p of paragraphs) {
    if (currentChunk.length + p.length > maxChunkLength) {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      currentChunk = p;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + p;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

/**
 * Lưu nội dung chương mới viết vào Supabase RAG (Novel Embeddings)
 */
export async function storeNovelEmbeddings({
  novelId,
  chapterId,
  chapterOrder,
  content,
  provider,
  modelId = "text-embedding-3-small" // Mặc định dùng chuẩn của OpenAI
}: {
  novelId: string;
  chapterId: string;
  chapterOrder: number;
  content: string;
  provider: AIProvider;
  modelId?: string;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Yêu cầu đăng nhập để lưu RAG lên kho chung.");

  const model = getEmbeddingModel(provider, modelId);
  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  let embeddings;
  try {
    const res = await embedMany({
      model,
      values: chunks,
    });
    embeddings = res.embeddings;
  } catch (err: any) {
    console.warn("Bỏ qua lỗi RAG vì model không hỗ trợ embedding:", err.message);
    return;
  }

  const records = chunks.map((chunk, i) => ({
    user_id: user.id,
    novel_id: novelId,
    chapter_id: chapterId,
    chapter_order: chapterOrder,
    content: chunk,
    embedding: embeddings[i],
  }));

  const { error } = await supabase.from("novel_embeddings").insert(records);
  if (error) {
    console.error("Lỗi khi đẩy vector lên Supabase:", error);
    throw new Error(`Supabase RAG Error: ${error.message}`);
  }
}

/**
 * Tìm kiếm bối cảnh liên quan từ Supabase RAG
 */
export async function searchNovelContext({
  novelId,
  query,
  provider,
  modelId = "text-embedding-3-small",
  matchCount = 5,
  matchThreshold = 0.5
}: {
  novelId: string;
  query: string;
  provider: AIProvider;
  modelId?: string;
  matchCount?: number;
  matchThreshold?: number;
}): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Yêu cầu đăng nhập để tìm kiếm RAG.");

  const model = getEmbeddingModel(provider, modelId);
  const { embedding } = await embed({
    model,
    value: query,
  });

  // Gọi RPC Supabase để tìm kiếm cosine similarity
  const { data, error } = await supabase.rpc("match_novel_embeddings", {
    query_embedding: embedding,
    match_novel_id: novelId,
    match_user_id: user.id,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) {
    console.error("Lỗi khi tìm kiếm RAG Supabase:", error);
    return "";
  }

  if (!data || data.length === 0) return "";

  // Sắp xếp các đoạn trả về theo thứ tự chương (để tạo mạch thời gian logic)
  // và nối chúng lại thành chuỗi context
  const contexts = (data as { content: string, chapter_order: number }[])
    .sort((a, b) => a.chapter_order - b.chapter_order)
    .map(d => d.content);

  return contexts.join("\n\n---\n\n");
}
