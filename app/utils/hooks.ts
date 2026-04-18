import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { useProviderStore } from "../store/provider";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const providerStore = useProviderStore();

  const models = useMemo(() => {
    // Convert provider store models to customModels string format
    const providerModels = providerStore.providers
      .filter((p) => p.enabled && p.models.length > 0)
      .flatMap((p) => p.models.map((m) => `+${m}@${p.type}`))
      .join(",");

    return collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels, providerModels].join(","),
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

