"use client";

import {
  WEBGPU_SYSTEM_PROVIDER_ID,
  filterApiInferenceProviders,
} from "@/lib/ai/api-inference";
import { db, type AIProvider, type AIModel } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { useProfile } from "./use-profile";

// ─── System Provider (always available, no CRUD) ────────────

export const WEBGPU_SYSTEM_PROVIDER: AIProvider = {
  id: WEBGPU_SYSTEM_PROVIDER_ID,
  name: "WebGPU (Miễn phí)",
  baseUrl: "",
  apiKey: "",
  isActive: true,
  providerType: "webgpu",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

export function isSystemProvider(id: string | undefined): boolean {
  return id === WEBGPU_SYSTEM_PROVIDER_ID;
}

import { useMemo, useState, useEffect } from "react";

// ─── Provider Queries ───────────────────────────────────────

export function useAIProviders() {
  const dbProviders = useLiveQuery(() =>
    db.aiProviders.orderBy("createdAt").reverse().toArray(),
  );
  const { profile, isVip, isAdmin } = useProfile();
  
  return useMemo(() => {
    if (!dbProviders) return undefined;
    const all = [...dbProviders, WEBGPU_SYSTEM_PROVIDER];
    
    // Show admin provider for VIPs or if they have some quota left (or are Admin)
    if (isVip || isAdmin || (profile?.admin_model_quota && profile.admin_model_quota > 0)) {
      const adminProvider: AIProvider = {
        id: "admin-provider",
        name: "Admin (Shared Pool)",
        baseUrl: "",
        apiKey: "",
        isActive: true,
        providerType: "openai-compatible",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      all.unshift(adminProvider);
    }
    
    return all;
  }, [dbProviders, profile?.admin_model_quota, isVip, isAdmin]);
}

/** Providers allowed for analysis, chapter tools, writing pipeline (excludes WebGPU). */
export function useApiInferenceProviders() {
  const all = useAIProviders();
  return filterApiInferenceProviders(all);
}

export function useAIProvider(id: string | undefined) {
  const dbProvider = useLiveQuery(
    () => (id && !isSystemProvider(id) ? db.aiProviders.get(id) : undefined),
    [id],
  );
  if (isSystemProvider(id)) return WEBGPU_SYSTEM_PROVIDER;
  return dbProvider;
}

export function useActiveProviders() {
  return useLiveQuery(() => db.aiProviders.filter((p) => p.isActive).toArray());
}

// ─── Provider Mutations ─────────────────────────────────────

export async function createAIProvider(
  data: Omit<AIProvider, "id" | "createdAt" | "updatedAt">,
) {
  const now = new Date();
  const id = crypto.randomUUID();
  await db.aiProviders.add({ ...data, id, createdAt: now, updatedAt: now });
  return id;
}

export async function updateAIProvider(
  id: string,
  data: Partial<Omit<AIProvider, "id" | "createdAt">>,
) {
  await db.aiProviders.update(id, { ...data, updatedAt: new Date() });
}

export async function deleteAIProvider(id: string) {
  await db.transaction("rw", [db.aiProviders, db.aiModels], async () => {
    await db.aiModels.where("providerId").equals(id).delete();
    await db.aiProviders.delete(id);
  });
}

// ─── Model Queries ──────────────────────────────────────────

// Static model entries for the system WebGPU provider (no DB storage)
const WEBGPU_SYSTEM_MODELS = (() => {
  // Lazy import to avoid circular deps — WEBGPU_MODELS is a simple array
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WEBGPU_MODELS } = require("@/lib/ai/webgpu-provider");
    return (
      WEBGPU_MODELS as Array<{
        modelId: string;
        name: string;
        sizeLabel: string;
      }>
    ).map((m) => ({
      id: m.modelId,
      providerId: WEBGPU_SYSTEM_PROVIDER.id,
      modelId: m.modelId,
      name: `${m.name} (${m.sizeLabel})`,
      createdAt: new Date(0),
    }));
  } catch {
    return [];
  }
})();

function sortModels<T extends { modelId: string; name?: string }>(
  models: T[],
): T[] {
  const key = (id: string) =>
    id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return models.sort((a, b) =>
    key(a.name || a.modelId).localeCompare(key(b.name || b.modelId)),
  );
}

export function useAIModels(providerId: string | undefined) {
  const { profile } = useProfile();
  const [adminModels, setAdminModels] = useState<AIModel[]>([]);

  const dbModels = useLiveQuery(
    () =>
      providerId && !isSystemProvider(providerId) && providerId !== "admin-provider"
        ? db.aiModels.where("providerId").equals(providerId).toArray()
        : [],
    [providerId],
  );

  useEffect(() => {
    if (providerId === "admin-provider") {
      fetch("/api/admin/models")
        .then(res => res.json())
        .then(data => {
          if (data && data.data) {
            const models = data.data.map((m: any) => ({
              id: m.id,
              providerId: "admin-provider",
              modelId: m.id,
              name: m.id.replace("gcli-", ""),
              createdAt: new Date()
            }));
            setAdminModels(models);
          }
        })
        .catch(err => console.error("Failed to fetch admin models", err));
    } else {
      setAdminModels([]);
    }
  }, [providerId]);

  if (isSystemProvider(providerId)) return WEBGPU_SYSTEM_MODELS;
  
  if (providerId === "admin-provider") {
    return adminModels;
  }

  return dbModels ? sortModels(dbModels) : dbModels;
}

export function useAllAIModels() {
  return useLiveQuery(() => db.aiModels.toArray());
}

// ─── Model Mutations ────────────────────────────────────────

export async function createAIModelManual(
  providerId: string,
  modelId: string,
  label: string,
) {
  const now = new Date();
  await db.aiModels.add({
    id: crypto.randomUUID(),
    providerId,
    modelId: modelId.trim(),
    name: label.trim() || modelId.trim(),
    createdAt: now,
  });
}

export async function updateAIModel(id: string, name: string) {
  await db.aiModels.update(id, { name: name.trim() });
}

export async function deleteAIModel(id: string) {
  await db.aiModels.delete(id);
}

async function syncModels(
  providerId: string,
  models: { id: string; name?: string }[],
) {
  const now = new Date();
  await db.transaction("rw", db.aiModels, async () => {
    await db.aiModels.where("providerId").equals(providerId).delete();
    await db.aiModels.bulkAdd(
      models.map((m) => ({
        id: crypto.randomUUID(),
        providerId,
        modelId: m.id,
        name: m.name || m.id,
        createdAt: now,
      })),
    );
  });
}

// ─── Fetch Models from Provider ─────────────────────────────

interface OpenAIModelsResponse {
  data: { id: string; name?: string }[];
}

interface GoogleModelsResponse {
  models: { name: string; displayName?: string }[];
}

async function fetchOpenAIModels(
  baseUrl: string,
  apiKey: string,
): Promise<{ id: string; name?: string }[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch models (${res.status}): ${await res.text()}`,
    );
  }
  const json: OpenAIModelsResponse = await res.json();
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Invalid response: expected { data: [...] }");
  }
  return json.data.sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchAnthropicModels(
  apiKey: string,
): Promise<{ id: string; name?: string }[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch models (${res.status}): ${await res.text()}`,
    );
  }
  const json = await res.json();
  const models = json.data ?? json.models ?? [];
  return models
    .map((m: { id?: string; name?: string }) => ({
      id: m.id ?? m.name ?? "",
      name: m.name ?? m.id,
    }))
    .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
}

async function fetchGoogleModels(
  apiKey: string,
): Promise<{ id: string; name?: string }[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch models (${res.status}): ${await res.text()}`,
    );
  }
  const json: GoogleModelsResponse = await res.json();
  return (json.models ?? [])
    .filter((m) => m.name.includes("gemini"))
    .map((m) => ({
      id: m.name.replace("models/", ""),
      name: m.displayName ?? m.name.replace("models/", ""),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchAndSyncModels(provider: AIProvider) {
  const type = provider.providerType ?? "openai-compatible";
  let models: { id: string; name?: string }[];

  switch (type) {
    case "anthropic":
      models = await fetchAnthropicModels(provider.apiKey);
      break;
    case "google":
      models = await fetchGoogleModels(provider.apiKey);
      break;
    case "webgpu":
      // System provider — models are static, no fetch needed
      return WEBGPU_SYSTEM_MODELS.length;
    case "openai":
    case "groq":
    case "mistral":
    case "xai":
    case "openrouter":
      models = await fetchOpenAIModels(
        provider.baseUrl || "https://api.openai.com/v1",
        provider.apiKey,
      );
      break;
    case "openai-compatible":
    default:
      models = await fetchOpenAIModels(provider.baseUrl, provider.apiKey);
      break;
  }

  await syncModels(provider.id, models);
  return models.length;
}
