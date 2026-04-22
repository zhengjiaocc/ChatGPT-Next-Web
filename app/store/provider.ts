import { StoreKey, ServiceProvider } from "../constant";
import { createPersistStore } from "../utils/store";
import { nanoid } from "nanoid";
import { useUserStore } from "./user";

function isLoggedIn() {
  return useUserStore.getState().loggedIn;
}

async function syncProviderToDB(p: ProviderInstance) {
  if (!isLoggedIn()) return;
  await fetch("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: p.id,
      type: p.type,
      label: p.label,
      api_key: p.apiKey,
      base_url: p.baseUrl,
      models: p.models,
      enabled: p.enabled,
    }),
  });
}

async function deleteProviderFromDB(id: string) {
  if (!isLoggedIn()) return;
  await fetch("/api/providers", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

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
      };
      set((s) => ({ providers: [...s.providers, instance] }));
      syncProviderToDB(instance);
      return instance.id;
    },

    updateProvider(id: string, patch: Partial<ProviderInstance>) {
      set((s) => ({
        providers: s.providers.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      }));
      const updated = useProviderStore
        .getState()
        .providers.find((p) => p.id === id);
      if (updated) syncProviderToDB(updated);
    },

    deleteProvider(id: string) {
      set((s) => ({
        providers: s.providers.filter((p) => p.id !== id),
      }));
      deleteProviderFromDB(id);
    },

    setModels(id: string, models: string[]) {
      set((s) => ({
        providers: s.providers.map((p) => (p.id === id ? { ...p, models } : p)),
      }));
      const updated = useProviderStore
        .getState()
        .providers.find((p) => p.id === id);
      if (updated) syncProviderToDB(updated);
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

    async loadFromDB() {
      if (!isLoggedIn()) return;
      const res = await fetch("/api/providers");
      if (res.status === 401) {
        useUserStore.getState().logout();
        set({ providers: [] });
        return;
      }
      if (!res.ok) return;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return;
      const providers: ProviderInstance[] = rows.map((r: any) => ({
        id: r.id,
        type: r.type as ServiceProvider,
        label: r.label,
        apiKey: r.api_key,
        baseUrl: r.base_url,
        models: r.models ?? [],
        enabled: r.enabled,
        supportsDiscovery: true,
      }));
      set({ providers });
    },
  }),
  {
    name: StoreKey.Provider,
    version: 1,
  },
);
