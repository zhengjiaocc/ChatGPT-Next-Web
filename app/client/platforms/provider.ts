"use client";
import { REQUEST_TIMEOUT_MS, OpenaiPath } from "@/app/constant";
import {
  useAppConfig,
  useChatStore,
  ChatMessageTool,
  usePluginStore,
} from "@/app/store";
import { streamWithThink } from "@/app/utils/chat";
import { getMessageTextContent } from "@/app/utils";
import { ChatOptions, LLMApi, LLMModel, LLMUsage, SpeechOptions } from "../api";
import { RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";
import { ProviderInstance } from "@/app/store/provider";

/**
 * Generic OpenAI-compatible API for provider store instances.
 * Used when the selected model comes from the provider store.
 */
export class ProviderStoreApi implements LLMApi {
  private provider: ProviderInstance;

  constructor(provider: ProviderInstance) {
    this.provider = provider;
  }

  path(path: string): string {
    let baseUrl = this.provider.baseUrl;
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    if (!baseUrl.startsWith("http")) baseUrl = "https://" + baseUrl;
    return [baseUrl, path].join("/");
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  async speech(options: SpeechOptions): Promise<ArrayBuffer> {
    const chatPath = this.path(OpenaiPath.SpeechPath);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.provider.apiKey}`,
    };

    const requestPayload = {
      model: options.model,
      input: options.input,
      voice: options.voice,
      speed: options.speed,
    };

    const res = await fetch(chatPath, {
      method: "POST",
      body: JSON.stringify(requestPayload),
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`TTS Request failed: ${res.status} ${errorText}`);
    }

    return await res.arrayBuffer();
  }

  async chat(options: ChatOptions) {
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      model: options.config.model,
    };

    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      messages.push({ role: v.role, content: getMessageTextContent(v) });
    }

    // Reasoning models only accept temperature=1, top_p=0.95
    const REASONING_MODEL_KEYWORDS = [
      "kimi-k",
      "-thinking",
      "o1",
      "o3",
      "o4-mini",
    ];
    const isReasoningModel = REASONING_MODEL_KEYWORDS.some((k) =>
      modelConfig.model.toLowerCase().includes(k),
    );

    const requestPayload: RequestPayload = {
      messages,
      stream: options.config.stream,
      model: modelConfig.model,
      temperature: isReasoningModel ? 1 : modelConfig.temperature,
      presence_penalty: modelConfig.presence_penalty,
      frequency_penalty: modelConfig.frequency_penalty,
      top_p: isReasoningModel ? 0.95 : modelConfig.top_p,
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.provider.apiKey}`,
    };

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(OpenaiPath.ChatPath);
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      if (shouldStream) {
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        return streamWithThink(
          chatPath,
          requestPayload,
          headers,
          tools as any,
          funcs,
          controller,
          (text: string, runTools: ChatMessageTool[]) => {
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                reasoning_content: string | null;
                tool_calls: ChatMessageTool[];
              };
            }>;
            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const index = tool_calls[0]?.index;
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }
            const reasoning = choices[0]?.delta?.reasoning_content;
            const content = choices[0]?.delta?.content;
            if (reasoning) return { isThinking: true, content: reasoning };
            return { isThinking: false, content: content ?? "" };
          },
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // @ts-ignore
            requestPayload?.messages?.splice(
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const res = await fetch(chatPath, {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers,
        });
        clearTimeout(requestTimeoutId);
        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[ProviderStoreApi] chat failed", e);
      options.onError?.(e as Error);
    }
  }

  async usage(): Promise<LLMUsage> {
    return { used: 0, total: 0 };
  }

  async models(): Promise<LLMModel[]> {
    return [];
  }
}
