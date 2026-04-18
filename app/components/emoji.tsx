import EmojiPicker, {
  Emoji,
  EmojiStyle,
  Theme as EmojiTheme,
} from "emoji-picker-react";

import { ModelType } from "../store";

import BotIconDefault from "../icons/llm-icons/default.svg";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";
import BotIconGemini from "../icons/llm-icons/gemini.svg";
import BotIconGemma from "../icons/llm-icons/gemma.svg";
import BotIconClaude from "../icons/llm-icons/claude.svg";
import BotIconMeta from "../icons/llm-icons/meta.svg";
import BotIconMistral from "../icons/llm-icons/mistral.svg";
import BotIconDeepseek from "../icons/llm-icons/deepseek.svg";
import BotIconMoonshot from "../icons/llm-icons/moonshot.svg";
import BotIconQwen from "../icons/llm-icons/qwen.svg";
import BotIconWenxin from "../icons/llm-icons/wenxin.svg";
import BotIconGrok from "../icons/llm-icons/grok.svg";
import BotIconHunyuan from "../icons/llm-icons/hunyuan.svg";
import BotIconDoubao from "../icons/llm-icons/doubao.svg";
import BotIconChatglm from "../icons/llm-icons/chatglm.svg";
import BotIconSiliconFlow from "../icons/llm-icons/siliconflow.svg";

export function getEmojiUrl(unified: string, style: EmojiStyle) {
  // Whoever owns this Content Delivery Network (CDN), I am using your CDN to serve emojis
  // Old CDN broken, so I had to switch to this one
  // Author: https://github.com/H0llyW00dzZ
  return `https://fastly.jsdelivr.net/npm/emoji-datasource-apple/img/${style}/64/${unified}.png`;
}

export function AvatarPicker(props: {
  onEmojiClick: (emojiId: string) => void;
}) {
  return (
    <EmojiPicker
      width={"100%"}
      lazyLoadEmojis
      theme={EmojiTheme.AUTO}
      getEmojiUrl={getEmojiUrl}
      onEmojiClick={(e) => {
        props.onEmojiClick(e.unified);
      }}
    />
  );
}

// Provider brand icons — matched against provider type keyword
const PROVIDER_ICON_RULES: Array<[icon: any, keywords: string[]]> = [
  [BotIconOpenAI, ["gpt", "openai"]],
  [BotIconClaude, ["claude", "anthropic"]],
  [BotIconGemini, ["gemini"]],
  [BotIconDeepseek, ["deepseek"]],
  [BotIconMoonshot, ["moonshot"]],
  [BotIconQwen, ["qwen"]],
  [BotIconGrok, ["grok", "xai"]],
  [BotIconHunyuan, ["hunyuan"]],
  [BotIconDoubao, ["doubao"]],
  [BotIconChatglm, ["glm"]],
  [BotIconSiliconFlow, ["siliconflow"]],
];

// Model name icons — matched against model name (includes product names like kimi)
const MODEL_ICON_RULES: Array<[icon: any, keywords: string[]]> = [
  [BotIconOpenAI, ["gpt", "chatgpt", "dall-e", "dalle", "o1", "o3", "o4"]],
  [BotIconClaude, ["claude", "anthropic"]],
  [BotIconGemini, ["gemini"]],
  [BotIconGemma, ["gemma"]],
  [BotIconDeepseek, ["deepseek"]],
  [BotIconMoonshot, ["moonshot", "kimi"]],
  [BotIconQwen, ["qwen", "qwq", "qvq"]],
  [BotIconGrok, ["grok", "xai"]],
  [BotIconMeta, ["llama", "meta"]],
  [BotIconMistral, ["mixtral", "mistral", "codestral"]],
  [BotIconWenxin, ["ernie", "wenxin"]],
  [BotIconHunyuan, ["hunyuan"]],
  [BotIconDoubao, ["doubao", "ep-"]],
  [BotIconChatglm, ["glm", "cogview-", "cogvideox-"]],
  [BotIconSiliconFlow, ["siliconflow"]],
];

export function Avatar(props: {
  model?: ModelType;
  avatar?: string;
  iconType?: "provider" | "model";
}) {
  if (props.model) {
    const modelName = props.model.toLowerCase();
    const rules =
      props.iconType === "provider" ? PROVIDER_ICON_RULES : MODEL_ICON_RULES;
    let LlmIcon = BotIconDefault;
    for (const [icon, keywords] of rules) {
      if (keywords.some((k) => modelName.includes(k))) {
        LlmIcon = icon;
        break;
      }
    }
    return (
      <div className="no-dark">
        <LlmIcon className="user-avatar" width={30} height={30} />
      </div>
    );
  }

  return (
    <div className="user-avatar">
      {props.avatar && <EmojiAvatar avatar={props.avatar} />}
    </div>
  );
}

export function EmojiAvatar(props: { avatar: string; size?: number }) {
  return (
    <Emoji
      unified={props.avatar}
      size={props.size ?? 18}
      getEmojiUrl={getEmojiUrl}
    />
  );
}
