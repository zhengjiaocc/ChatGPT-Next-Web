export function estimateTokenLength(input: string): number {
  let tokenLength = 0;

  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);

    if (charCode < 128) {
      // ASCII 字符
      if (charCode <= 122 && charCode >= 65) {
        // a-Z
        tokenLength += 0.25;
      } else {
        tokenLength += 0.5;
      }
    } else {
      // Unicode 字符（中文等）
      tokenLength += 1.5;
    }
  }

  return tokenLength;
}

/**
 * 主流模型的输入上下文窗口（Token 数），用于计算实际可用的历史消息预算。
 * 如果模型未命中映射表，返回一个保守的默认值 8192。
 */
export const MODEL_CONTEXT_WINDOW: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  "o1": 200000,
  "o1-mini": 128000,
  "o3-mini": 200000,

  // Anthropic Claude
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022": 200000,
  "claude-3-opus-20240229": 200000,
  "claude-sonnet-4-5": 200000,

  // Google Gemini
  "gemini-2.0-flash": 1048576,
  "gemini-2.5-pro": 1048576,
  "gemini-1.5-pro": 2097152,
  "gemini-1.5-flash": 1048576,

  // DeepSeek
  "deepseek-chat": 65536,
  "deepseek-reasoner": 65536,

  // 保底默认值
  default: 8192,
};

/**
 * 获取模型可用于携带历史消息的有效 Token 数量。
 * 策略：窗口总量 - 预留给输出的 Token - 500（系统提示安全边际）。
 * @param modelName 模型名称
 * @param maxOutputTokens 预留给输出的 Token 数（用户配置的 max_tokens）
 */
export function getAvailableContextTokens(
  modelName: string,
  maxOutputTokens: number,
): number {
  // 按模型名前缀模糊匹配
  const windowSize =
    Object.entries(MODEL_CONTEXT_WINDOW).find(([key]) =>
      modelName.toLowerCase().startsWith(key.toLowerCase()),
    )?.[1] ?? MODEL_CONTEXT_WINDOW.default;

  // 可用输入预算 = 窗口总量 - 预留输出 Token - 500
  const available = windowSize - maxOutputTokens - 500;

  // 最小保证 2000 Token，最大不超过窗口的 85%
  return Math.max(2000, Math.min(available, Math.floor(windowSize * 0.85)));
}
