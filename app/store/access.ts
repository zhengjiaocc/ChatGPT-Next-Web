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
  accessCode: "",
  useCustomConfig: false,

  provider: ServiceProvider.OpenAI,

  // server config
  needCode: true,
  hideUserApiKey: false,
  hideBalanceQuery: false,
  disableGPT4: false,
  disableFastLink: false,
  customModels: "",
  defaultModel: "",
  visionModels: "",

  // tts config
  edgeTTSVoiceName: "zh-CN-YunxiNeural",
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      this.fetch();
      return get().needCode;
    },
    getVisionModels() {
      this.fetch();
      return get().visionModels;
    },
    edgeVoiceName() {
      this.fetch();
      return get().edgeTTSVoiceName;
    },
    isAuthorized() {
      this.fetch();
      // has token or has code or disabled access control
      return (
        !this.enabledAccessControl() ||
        (this.enabledAccessControl() && ensure(get(), ["accessCode"]))
      );
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
