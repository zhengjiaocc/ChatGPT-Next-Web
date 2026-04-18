import { StoreKey, ServiceProvider } from "../constant";
import { createPersistStore } from "../utils/store";
import { nanoid } from "nanoid";

export interface ProviderInstance {
  id: string;
  type: ServiceProvider;
  label: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
  supportsDiscovery: boolean;
}

// Preset provider types with default base URLs
export const PROVIDER_PRESETS: Record<
  string,
  { label: string; baseUrl: string }
> = {
  [ServiceProvider.OpenAI]: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com",
  },
  [ServiceProvider.Anthropic]: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
  },
  [ServiceProvider.Google]: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
  },
  [ServiceProvider.DeepSeek]: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
  },
  [ServiceProvider.XAI]: {
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai",
  },
  [ServiceProvider.SiliconFlow]: {
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn",
  },
  [ServiceProvider.Moonshot]: {
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn",
  },
  [ServiceProvider.Alibaba]: {
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  },
};

const DEFAULT_PROVIDER_STATE = {
  providers: [] as ProviderInstance[],
};

export const useProviderStore = createPersistStore(
  DEFAULT_PROVIDER_STATE,
  (set, get) => ({
    addProvider(
      type: ServiceProvider,
      label: string,
      apiKey: string,
      baseUrl: string,
    ) {
      const instance: ProviderInstance = {
        id: nanoid(),
        type,
        label,
        apiKey,
        baseUrl: baseUrl || PROVIDER_PRESETS[type]?.baseUrl || "",
        models: [],
        enabled: true,
        supportsDiscovery: true,
        openaiCompatible: PROVIDER_PRESETS[type]?.openaiCompatible ?? true,
      };
      set((s) => ({ providers: [...s.providers, instance] }));
      return instance.id;
    },

    updateProvider(id: string, patch: Partial<ProviderInstance>) {
      set((s) => ({
        providers: s.providers.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      }));
    },

    deleteProvider(id: string) {
      set((s) => ({
        providers: s.providers.filter((p) => p.id !== id),
      }));
    },

    setModels(id: string, models: string[]) {
      set((s) => ({
        providers: s.providers.map((p) => (p.id === id ? { ...p, models } : p)),
      }));
    },

    getEnabledModels() {
      return get()
        .providers.filter((p) => p.enabled && p.models.length > 0)
        .flatMap((p) =>
          p.models.map((m) => ({
            name: m,
            providerId: p.id,
            providerLabel: p.label || PROVIDER_PRESETS[p.type]?.label || p.type,
            providerType: p.type,
          })),
        );
    },
  }),
  {
    name: StoreKey.Provider,
    version: 1,
  },
);
