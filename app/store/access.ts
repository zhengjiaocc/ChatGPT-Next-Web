import {
  ServiceProvider,
  StoreKey,
} from "../constant";
import { getClientConfig } from "../config/client";
import { createPersistStore } from "../utils/store";
import { ensure } from "../utils/clone";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const isApp = getClientConfig()?.buildMode === "export";

const DEFAULT_ACCESS_STATE = {
  useCustomConfig: false,

  provider: ServiceProvider.OpenAI,

  // server config
  hideBalanceQuery: false,
  customModels: "",
  defaultModel: "",
  visionModels: "",

  // tts config
  edgeTTSVoiceName: "zh-CN-YunxiNeural",
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({

    getVisionModels() {
      this.fetch();
      return get().visionModels;
    },
    edgeVoiceName() {
      this.fetch();
      return get().edgeTTSVoiceName;
    },
    isAuthorized() {
      // 在新的纯 SaaS 架构中，能够进入核心路由页面的必然持有服务器下发的有效 JWT
      // 此处原是用于兼顾验证“公共访问密码”，现已废弃该旧版安全机制，故恒定放行。
      return true;
    },
    fetch() {
      // 遗留自远古单机开源版的路由，已删除 /api/config 接口，这里置为空
      return;
    },
  }),
  {
    name: StoreKey.Access,
    version: 2,
  },
);
