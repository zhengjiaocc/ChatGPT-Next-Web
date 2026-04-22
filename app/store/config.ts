import { LLMModel } from "../client/api";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { getClientConfig } from "../config/client";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_TTS_ENGINE,
  DEFAULT_TTS_ENGINES,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_MODELS,
  StoreKey,
  ServiceProvider,
} from "../constant";
import { createPersistStore } from "../utils/store";
import type { Voice } from "rt-client";
import { useUserStore } from "./user";

function isLoggedIn() {
  return useUserStore.getState().loggedIn;
}

// DEFAULT_MODELS 为空数组，类型不再从中推导，直接用 string
export type ModelType = string;
export type TTSModelType = (typeof DEFAULT_TTS_MODELS)[number];
export type TTSEngineType = (typeof DEFAULT_TTS_ENGINES)[number];

export enum SubmitKey {
  Enter = "Enter",
  CtrlEnter = "Ctrl + Enter",
  ShiftEnter = "Shift + Enter",
  AltEnter = "Alt + Enter",
  MetaEnter = "Meta + Enter",
}

export enum Theme {
  Auto = "auto",
  Dark = "dark",
  Light = "light",
}

const config = getClientConfig();

export const DEFAULT_CONFIG = {
  lastUpdate: Date.now(), // timestamp, to merge state

  submitKey: SubmitKey.Enter,
  avatar: "1f603",
  fontSize: 14,
  fontFamily: "",
  theme: Theme.Auto as Theme,
  tightBorder: !!config?.isApp,
  sendPreviewBubble: true,
  enableAutoGenerateTitle: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,

  enableArtifacts: true, // show artifacts config

  enableCodeFold: true, // code fold config

  disablePromptHint: false,

  dontShowMaskSplashScreen: false, // dont show splash screen when create chat
  hideBuiltinMasks: false, // dont add builtin masks

  customModels: "",
  models: [] as LLMModel[],

  modelConfig: {
    model: "" as ModelType,
    providerName: "" as ServiceProvider,
    providerId: "",
    temperature: 0.5,
    top_p: 1,
    max_tokens: 8192,
    presence_penalty: 0,
    frequency_penalty: 0,
    sendMemory: true,
    historyMessageCount: 16,
    compressMessageLengthThreshold: 32000,
    compressModel: "",
    compressProviderName: "",
    compressProviderId: "",
    enableInjectSystemPrompts: true,
    template: config?.template ?? DEFAULT_INPUT_TEMPLATE,
    size: "1024x1024" as ModelSize,
    quality: "standard" as DalleQuality,
    style: "vivid" as DalleStyle,
  },

  ttsConfig: {
    enable: false,
    autoplay: false,
    engine: DEFAULT_TTS_ENGINE,
    model: DEFAULT_TTS_MODEL,
    speed: 1.0,
    providerId: "",
  },

  realtimeConfig: {
    enable: false,
    provider: "OpenAI" as ServiceProvider,
    model: "gpt-4o-realtime-preview-2024-10-01",
    apiKey: "",
    azure: {
      endpoint: "",
      deployment: "",
    },
    temperature: 0.9,
    voice: "alloy" as Voice,
  },
};

export type ChatConfig = typeof DEFAULT_CONFIG;

export type ModelConfig = ChatConfig["modelConfig"];
export type TTSConfig = ChatConfig["ttsConfig"];
export type RealtimeConfig = ChatConfig["realtimeConfig"];

export function limitNumber(
  x: number,
  min: number,
  max: number,
  defaultValue: number,
) {
  if (isNaN(x)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, x));
}

export const TTSConfigValidator = {
  engine(x: string) {
    return x as TTSEngineType;
  },
  model(x: string) {
    return x as TTSModelType;
  },
  speed(x: number) {
    return limitNumber(x, 0.25, 4.0, 1.0);
  },
};

export const ModalConfigValidator = {
  model(x: string) {
    return x as ModelType;
  },
  max_tokens(x: number) {
    return limitNumber(x, 0, 512000, 1024);
  },
  presence_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  frequency_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  temperature(x: number) {
    return limitNumber(x, 0, 2, 1);
  },
  top_p(x: number) {
    return limitNumber(x, 0, 1, 1);
  },
};

export const useAppConfig = createPersistStore(
  { ...DEFAULT_CONFIG },
  (set, get) => ({
    reset() {
      // 重置时保留纯本地视图属性（如侧边栏宽度），防止因页面重算导致的瞬间放缩闪烁闪跳
      set((state) => ({ ...DEFAULT_CONFIG, sidebarWidth: state.sidebarWidth }));
    },

    update(updater: (config: ChatConfig) => void) {
      const state = get();
      updater(state);
      set({ ...state });
      get().markUpdate();
      (get() as any).syncToDB();
    },

    mergeModels(newModels: LLMModel[]) {
      if (!newModels || newModels.length === 0) {
        return;
      }

      const oldModels = get().models;
      const modelMap: Record<string, LLMModel> = {};

      for (const model of oldModels) {
        model.available = false;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      for (const model of newModels) {
        model.available = true;
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      set(() => ({
        models: Object.values(modelMap),
      }));
    },

    async syncToDB() {
      if (!isLoggedIn()) return;
      const state = get();
      const { models, ...config } = state as any;
      await fetch("/api/user/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
    },

    async loadFromDB() {
      if (!isLoggedIn()) return;
      const res = await fetch("/api/user/config");
      if (res.status === 401) {
        useUserStore.getState().logout();
        set(() => ({ ...DEFAULT_CONFIG }));
        return;
      }
      if (!res.ok) return;
      const config = await res.json();
      if (config && Object.keys(config).length > 0) {
        // 从云端配置中剔除 sidebarWidth，侧边栏大小应留在本地，漫游会导致桌面端收起状态被别的设备宽状态强行冲掉而闪烁
        const { sidebarWidth, ...cloudConfig } = config;

        // 对云端 modelConfig 做迁移清洗：
        // 云端可能保存了已废弃的内置模型名（如 gpt-4o-mini / gpt-3.5-turbo）
        // 这些模型已从系统中移除，必须在加载时清空，避免覆盖本地迁移结果
        let needResync = false;
        if (cloudConfig.modelConfig) {
          const mc = cloudConfig.modelConfig;
          // 简单规则：如果 providerId 为空但 model/compressModel 非空，
          // 说明是旧版本写入的硬编码模型名，强制清空
          if (!mc.providerId && mc.model) {
            mc.model = "";
            mc.providerName = "";
            needResync = true;
          }
          if (!mc.compressProviderId && mc.compressModel) {
            mc.compressModel = "";
            mc.compressProviderName = "";
            needResync = true;
          }
        }

        set((state) => ({ ...state, ...cloudConfig }));

        // 如果清洗了脏数据，立即回写云端，保持云端也是干净状态
        if (needResync) {
          (get() as any).syncToDB();
        }
      }
    },
  }),
  {
    name: StoreKey.Config,
    version: 4.6,

    merge(persistedState, currentState) {
      const state = persistedState as ChatConfig | undefined;
      if (!state) return { ...currentState };
      const models = currentState.models.slice();
      state.models.forEach((pModel) => {
        const idx = models.findIndex(
          (v) => v.name === pModel.name && v.provider === pModel.provider,
        );
        if (idx !== -1) models[idx] = pModel;
        else models.push(pModel);
      });
      return { ...currentState, ...state, models: models };
    },

    migrate(persistedState, version) {
      const state = persistedState as ChatConfig;

      if (version < 4.5) {
        // 彻底清空所有旧缓存模型名，强制用户重新从供应商列表中选择
        state.modelConfig.model = "" as ModelType;
        state.modelConfig.providerName = "" as ServiceProvider;
        state.modelConfig.providerId = "";
        state.modelConfig.compressModel = "";
        state.modelConfig.compressProviderName = "" as ServiceProvider;
        state.modelConfig.compressProviderId = "";
      }

      if (version < 4.6) {
        if (state.ttsConfig && !state.ttsConfig.providerId) {
          state.ttsConfig.providerId = "";
        }
      }

      return state as any;
    },
  },
);
