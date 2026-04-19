import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { useProviderStore } from "../store/provider";
import { LLMModel } from "../client/api";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const providerStore = useProviderStore();

  const models = useMemo(() => {
    const enabledProviders = providerStore.providers.filter(
      (p) => p.enabled && p.models.length > 0,
    );

    if (enabledProviders.length > 0) {
      // Build LLMModel[] directly, preserving instance id as provider.id
      const providerModels: LLMModel[] = enabledProviders.flatMap((p) =>
        p.models.map((m, i) => ({
          name: m,
          displayName: m,
          available: true,
          sorted: i,
          provider: {
            id: p.id, // instance id — used to look up apiKey directly
            providerName: p.label || p.type,
            providerType: p.type,
            sorted: 0,
          },
        })),
      );
      return collectModelsWithDefaultModel(
        providerModels,
        accessStore.defaultModel ? `=${accessStore.defaultModel}` : "",
        accessStore.defaultModel,
      );
    }

    return collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
    providerStore.providers,
  ]);

  return models;
}
