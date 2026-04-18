import { ServiceProvider } from "../constant";

export const PROVIDER_ICON_MODEL: Record<string, string> = {
  [ServiceProvider.OpenAI]: "gpt",
  [ServiceProvider.Anthropic]: "claude",
  [ServiceProvider.Google]: "gemini",
  [ServiceProvider.DeepSeek]: "deepseek",
  [ServiceProvider.XAI]: "grok",
  [ServiceProvider.Moonshot]: "moonshot",
  [ServiceProvider.SiliconFlow]: "siliconflow",
  [ServiceProvider.Alibaba]: "qwen",
  [ServiceProvider.ByteDance]: "doubao",
  [ServiceProvider.Tencent]: "hunyuan",
  [ServiceProvider.ChatGLM]: "glm",
};
