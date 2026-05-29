import { getModel } from "@/lib/ai/provider";
import { db, type StepModelConfig } from "@/lib/db";
import type { LanguageModel } from "ai";

/**
 * Resolve a StepModelConfig to a LanguageModel instance.
 * Returns undefined if config is missing or provider not found.
 */
export async function resolveStep(
  cfg: StepModelConfig | undefined,
): Promise<LanguageModel | undefined> {
  if (!cfg?.providerId || !cfg?.modelId) return undefined;

  // Intercept Admin Provider
  if (cfg.providerId === "admin-provider") {
    return await getModel(
      {
        id: "admin-provider",
        name: "Model Admin",
        baseUrl: "https://dummy.local/api/ai-proxy", // Must be absolute for URL constructor
        apiKey: "admin-model-key",
      } as unknown as import("@/lib/db").AIProvider,
      cfg.modelId, // will be "admin-model"
    );
  }

  const provider = await db.aiProviders.get(cfg.providerId);
  if (!provider) return undefined;

  let resolvedModelId = cfg.modelId;
  try {
    const aiModel = await db.aiModels.get(cfg.modelId);
    if (aiModel) {
      resolvedModelId = aiModel.modelId;
    }
  } catch (e) {
    console.warn("Failed to retrieve aiModel from Dexie", e);
  }

  return await getModel(provider, resolvedModelId);
}
