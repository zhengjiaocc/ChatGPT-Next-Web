import { NextRequest } from "next/server";
import { getServerSideConfig } from "../config/server";
import { ModelProvider } from "../constant";

export function auth(req: NextRequest, modelProvider: ModelProvider) {
  const serverConfig = getServerSideConfig();
  let systemApiKey: string | undefined;

  switch (modelProvider) {
    case ModelProvider.Stability:
      systemApiKey = serverConfig.stabilityApiKey;
      break;
    case ModelProvider.GeminiPro:
      systemApiKey = serverConfig.googleApiKey;
      break;
    case ModelProvider.Claude:
      systemApiKey = serverConfig.anthropicApiKey;
      break;
    case ModelProvider.Doubao:
      systemApiKey = serverConfig.bytedanceApiKey;
      break;
    case ModelProvider.Ernie:
      systemApiKey = serverConfig.baiduApiKey;
      break;
    case ModelProvider.Qwen:
      systemApiKey = serverConfig.alibabaApiKey;
      break;
    case ModelProvider.Moonshot:
      systemApiKey = serverConfig.moonshotApiKey;
      break;
    case ModelProvider.Iflytek:
      systemApiKey = serverConfig.iflytekApiKey + ":" + serverConfig.iflytekApiSecret;
      break;
    case ModelProvider.DeepSeek:
      systemApiKey = serverConfig.deepseekApiKey;
      break;
    case ModelProvider.XAI:
      systemApiKey = serverConfig.xaiApiKey;
      break;
    case ModelProvider.ChatGLM:
      systemApiKey = serverConfig.chatglmApiKey;
      break;
    case ModelProvider.SiliconFlow:
      systemApiKey = serverConfig.siliconFlowApiKey;
      break;
    case ModelProvider.GPT:
    default:
      if (req.nextUrl.pathname.includes("azure/deployments")) {
        systemApiKey = serverConfig.azureApiKey;
      } else {
        systemApiKey = serverConfig.apiKey;
      }
  }

  if (systemApiKey) {
    req.headers.set("Authorization", `Bearer ${systemApiKey}`);
  }

  // 始终放行。没有 JWT Cookie 的人根本进不来这里所以永远无需校验权限
  return {
    error: false,
  };
}
