import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { useProviderStore } from "../store/provider";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const providerStore = useProviderStore();

  const models = useMemo(() => {
    const providerModels = providerStore.providers
      .filter((p) => p.enabled && p.models.length > 0)
      .flatMap((p) => p.models.map((m) => `+${m}@${p.type}`))
      .join(",");

    // If provider store has models, only show those; otherwise fall back to defaults
    const hasProviderModels = providerModels.length > 0;
    const baseModels = hasProviderModels ? [] : configStore.models;
    const customModels = hasProviderModels
      ? providerModels
      : [configStore.customModels, accessStore.customModels].join(",");

    return collectModelsWithDefaultModel(
      baseModels,
      customModels,
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
