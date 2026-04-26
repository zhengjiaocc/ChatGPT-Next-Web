import {
  getMessageTextContent,
  isDalle3,
  safeLocalStorage,
  trimTopic,
  normalizeMessages,
} from "../utils";

import { indexedDBStorage } from "@/app/utils/indexedDB-storage";
import { nanoid } from "nanoid";
import type {
  ClientApi,
  MultimodalContent,
  RequestMessage,
} from "../client/api";
import { getClientApi } from "../client/api";
import { useProviderStore } from "./provider";
import { ProviderStoreApi } from "../client/platforms/provider";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  DEFAULT_INPUT_TEMPLATE,
  KnowledgeCutOffDate,
  MCP_SYSTEM_TEMPLATE,
  MCP_TOOLS_TEMPLATE,
  ServiceProvider,
  StoreKey,
} from "../constant";
import Locale, { getLang } from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore } from "../utils/store";
import { estimateTokenLength, getAvailableContextTokens } from "../utils/token";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { createEmptyMask, Mask } from "./mask";
import { executeMcpAction, getAllTools, isMcpEnabled } from "../mcp/actions";
import { extractMcpJson, isMcpJson } from "../mcp/utils";

import { useUserStore } from "./user";

const localStorage = safeLocalStorage();
const DB_FETCH_TIMEOUT = 12_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DB_FETCH_TIMEOUT,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export type ChatMessageTool = {
  id: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
  content?: string;
  isError?: boolean;
  errorMsg?: string;
};

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  tools?: ChatMessageTool[];
  audio_url?: string;
  isMcpResponse?: boolean;
  /**
   * 发送该条消息时的上下文信息快照（用于 UI 展示）。
   * 注意：这是“真实发送值”，而不是基于配置的估算。
   */
  contextInfo?: {
    sentCount: number;
    contextPromptsCount: number;
    hasLongTermMemory: boolean;
    memoryPrompt?: string;
    historyMessages?: Array<{
      role: string;
      content: string;
    }>;
  };
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface MemoryHistoryEntry {
  summary: string;
  fromIndex: number;
  toIndex: number;
  isUpdate: boolean;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  topic: string;
  customTopic?: boolean;

  memoryPrompt: string;
  memoryHistory: MemoryHistoryEntry[];
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
  messagesLoaded?: boolean;
  messageCount?: number;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});

function createEmptySession(): ChatSession {
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    memoryHistory: [],
    messages: [],
    messagesLoaded: true,
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,

    mask: createEmptyMask(),
  };
}

function getSummarizeModel(
  currentModel: string,
  providerName: string,
): string[] {
  return [currentModel, providerName];
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const cutoff =
    KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;
  // 供应商名称直接取自 modelConfig.providerName
  const serviceProvider = modelConfig.providerName || "OpenAI";

  const vars = {
    ServiceProvider: serviceProvider,
    cutoff,
    model: modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

async function getMcpSystemPrompt(): Promise<string> {
  const tools = await getAllTools();

  let toolsStr = "";

  tools.forEach((i) => {
    // error client has no tools
    if (!i.tools) return;

    toolsStr += MCP_TOOLS_TEMPLATE.replace(
      "{{ clientId }}",
      i.clientId,
    ).replace(
      "{{ tools }}",
      i.tools.tools.map((p: object) => JSON.stringify(p, null, 2)).join("\n"),
    );
  });

  return MCP_SYSTEM_TEMPLATE.replace("{{ MCP_TOOLS }}", toolsStr);
}

function isLoggedIn() {
  return useUserStore.getState().loggedIn;
}

type SessionSyncPayload = {
  id: string;
  title: string;
  model: string;
  mask: Mask;
  memoryPrompt: string;
  memoryHistory: MemoryHistoryEntry[];
  lastSummarizeIndex: number;
  updatedAt: number;
};

const SESSION_SYNC_DEBOUNCE_MS = 500;
const sessionSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSessionSyncPayload = new Map<string, SessionSyncPayload>();
const sessionSyncRunning = new Map<string, boolean>();
export const summarizingSessionIds = new Set<string>();
let syncFlushEventsInstalled = false;

function clearAllSessionSyncTasks() {
  sessionSyncTimers.forEach((timer) => clearTimeout(timer));
  sessionSyncTimers.clear();
  pendingSessionSyncPayload.clear();
  sessionSyncRunning.clear();
}

function buildSessionSyncPayload(
  session: ChatSession,
): SessionSyncPayload | undefined {
  if (session.messagesLoaded === false) return;
  if (session.messages.length === 0 && session.topic === DEFAULT_TOPIC) return;
  return {
    id: session.id,
    title: session.topic,
    model: session.mask.modelConfig.model,
    mask: session.mask,
    memoryPrompt: session.memoryPrompt,
    memoryHistory: session.memoryHistory ?? [],
    lastSummarizeIndex: session.lastSummarizeIndex,
    updatedAt: session.lastUpdate || Date.now(),
  };
}

function isMeaningfulSession(session?: ChatSession) {
  if (!session) return false;
  return session.messages.length > 0 || session.topic !== DEFAULT_TOPIC;
}

function getPersistableMessages(session: ChatSession) {
  return (session.messages ?? []).filter(
    (m) =>
      !!m?.id &&
      !m.streaming &&
      !m.isError &&
      getMessageTextContent(m).trim().length > 0,
  );
}

function sanitizeSession(session: ChatSession): ChatSession {
  const fixed = { ...session };

  const seenMessageIds = new Set<string>();
  fixed.messages = (session.messages ?? []).filter((m) => {
    const id = m?.id;
    if (!id) return false;
    if (seenMessageIds.has(id)) return false;
    seenMessageIds.add(id);
    return true;
  });

  // For cloud sessions with lazy-loaded messages, messages may be empty
  // temporarily even though messageCount/lastSummarizeIndex are valid.
  // Avoid collapsing lastSummarizeIndex to 0 in that transient state.
  const summarizeUpperBound =
    fixed.messagesLoaded === false
      ? Math.max(fixed.messageCount ?? 0, fixed.lastSummarizeIndex ?? 0)
      : fixed.messages.length;
  fixed.lastSummarizeIndex = Math.max(
    0,
    Math.min(fixed.lastSummarizeIndex ?? 0, summarizeUpperBound),
  );

  if (typeof fixed.clearContextIndex === "number") {
    fixed.clearContextIndex = Math.max(
      0,
      Math.min(fixed.clearContextIndex, fixed.messages.length),
    );
  }

  if (fixed.messagesLoaded !== false) {
    fixed.messageCount = fixed.messages.length;
  } else {
    fixed.messageCount = Math.max(
      fixed.messageCount ?? 0,
      fixed.messages.length,
    );
  }

  if (!fixed.lastUpdate || !Number.isFinite(fixed.lastUpdate)) {
    const lastMsgTs = new Date(fixed.messages.at(-1)?.date ?? 0).getTime();
    fixed.lastUpdate =
      Number.isFinite(lastMsgTs) && lastMsgTs > 0 ? lastMsgTs : Date.now();
  }

  return fixed;
}

function sanitizeSessions(sessions: ChatSession[]): ChatSession[] {
  const byId = new Map<string, ChatSession>();
  for (const raw of sessions) {
    const session = sanitizeSession(raw);
    if (!session.id) continue;
    const existed = byId.get(session.id);
    if (!existed) {
      byId.set(session.id, session);
      continue;
    }
    byId.set(
      session.id,
      (session.lastUpdate || 0) > (existed.lastUpdate || 0) ? session : existed,
    );
  }

  const normalized = Array.from(byId.values())
    .filter(isMeaningfulSession)
    .sort((a, b) => {
      const byTime = (b.lastUpdate || 0) - (a.lastUpdate || 0);
      if (byTime !== 0) return byTime;
      return b.id.localeCompare(a.id);
    });

  return normalized.length > 0 ? normalized : [createEmptySession()];
}

async function syncSessionPayloadToDB(
  payload: SessionSyncPayload,
  retries = 3,
) {
  for (let i = 0; i < retries; i++) {
    try {
      const metaRes = await fetchWithTimeout(
        `/api/sessions/${encodeURIComponent(payload.id)}/meta`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: payload.title,
            model: payload.model,
            mask: payload.mask,
            updatedAt: payload.updatedAt,
          }),
        },
      );
      const memRes = await fetchWithTimeout(
        `/api/sessions/${encodeURIComponent(payload.id)}/memory`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memoryPrompt: payload.memoryPrompt,
            memoryHistory: payload.memoryHistory,
            lastSummarizeIndex: payload.lastSummarizeIndex,
            updatedAt: payload.updatedAt,
          }),
        },
      );
      if (metaRes.ok && memRes.ok) return true;
    } catch (e) {
      if (i === retries - 1) console.error("[Sync] failed to sync session", e);
    }
  }
  return false;
}

function trySendBeaconSync(payload: SessionSyncPayload) {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.sendBeacon !== "function") return false;
  try {
    const metaBlob = new Blob(
      [
        JSON.stringify({
          title: payload.title,
          model: payload.model,
          mask: payload.mask,
          updatedAt: payload.updatedAt,
        }),
      ],
      { type: "application/json" },
    );
    const memBlob = new Blob(
      [
        JSON.stringify({
          memoryPrompt: payload.memoryPrompt,
          memoryHistory: payload.memoryHistory,
          lastSummarizeIndex: payload.lastSummarizeIndex,
          updatedAt: payload.updatedAt,
        }),
      ],
      { type: "application/json" },
    );
    const ok1 = navigator.sendBeacon(
      `/api/sessions/${encodeURIComponent(payload.id)}/meta`,
      metaBlob,
    );
    const ok2 = navigator.sendBeacon(
      `/api/sessions/${encodeURIComponent(payload.id)}/memory`,
      memBlob,
    );
    return ok1 && ok2;
  } catch {
    return false;
  }
}

function ensureSyncFlushEvents() {
  if (syncFlushEventsInstalled) return;
  if (typeof window === "undefined") return;
  syncFlushEventsInstalled = true;

  const flushAll = () => {
    pendingSessionSyncPayload.forEach((payload) => {
      // best-effort during page hide/unload
      trySendBeaconSync(payload);
    });
  };

  window.addEventListener("beforeunload", flushAll);
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}

async function flushSessionSyncQueue(sessionId: string, depth = 0) {
  if (depth > 10) return;
  if (sessionSyncRunning.get(sessionId)) return;
  const payload = pendingSessionSyncPayload.get(sessionId);
  if (!payload) return;

  sessionSyncRunning.set(sessionId, true);
  pendingSessionSyncPayload.delete(sessionId);
  try {
    await syncSessionPayloadToDB(payload);
  } finally {
    sessionSyncRunning.set(sessionId, false);
    if (pendingSessionSyncPayload.has(sessionId)) {
      void flushSessionSyncQueue(sessionId, depth + 1);
    }
  }
}

async function syncSessionToDB(session: ChatSession) {
  if (!isLoggedIn()) return;
  ensureSyncFlushEvents();
  const payload = buildSessionSyncPayload(session);
  if (!payload) return;

  pendingSessionSyncPayload.set(session.id, payload);
  const timer = sessionSyncTimers.get(session.id);
  if (timer) clearTimeout(timer);
  sessionSyncTimers.set(
    session.id,
    setTimeout(() => {
      sessionSyncTimers.delete(session.id);
      void flushSessionSyncQueue(session.id);
    }, SESSION_SYNC_DEBOUNCE_MS),
  );
}

async function syncSessionMessagesToDB(
  session: ChatSession,
  messages: ChatMessage[],
) {
  if (!isLoggedIn()) return;
  const persistable = messages.filter(
    (m) =>
      !!m?.id &&
      !m.streaming &&
      !m.isError &&
      getMessageTextContent(m).trim().length > 0,
  );
  if (persistable.length === 0) return;
  const body = JSON.stringify({
    title: session.topic,
    messages: persistable,
    model: session.mask.modelConfig.model,
    mask: session.mask,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `/api/sessions/${session.id}/messages`,
        {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
      console.log(
        "[Sync] POST messages",
        session.id,
        persistable.length,
        res.status,
      );
      if (res.ok) return;
    } catch (e) {
      if (attempt === 2) console.error("[Sync] failed after 3 attempts", e);
      else await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function deleteSessionFromDB(id: string) {
  if (!isLoggedIn()) return;
  const timer = sessionSyncTimers.get(id);
  if (timer) clearTimeout(timer);
  sessionSyncTimers.delete(id);
  pendingSessionSyncPayload.delete(id);
  sessionSyncRunning.delete(id);
  const body = JSON.stringify({ id });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `/api/sessions/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
      if (res.ok) return;
    } catch (e) {
      if (attempt === 2) console.error("[Sync] failed to delete session", e);
      else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
  lastInput: "",
  hiddenSessionIds: [] as string[],
  summarizingIds: [] as string[],
  dbLoaded: false,
  dbLoadState: "idle" as "idle" | "loading" | "ready" | "error",
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      forkSession() {
        // 获取当前会话
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        newSession.messagesLoaded = true;
        // 深拷贝消息
        newSession.messages = currentSession.messages.map((msg) => ({
          ...msg,
          id: nanoid(), // 生成新的消息 ID
        }));
        newSession.mask = {
          ...currentSession.mask,
          modelConfig: {
            ...currentSession.mask.modelConfig,
          },
        };

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [newSession, ...state.sessions],
        }));
      },

      clearSessions() {
        clearAllSessionSyncTasks();
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(mask?: Mask) {
        const session = createEmptySession();
        session.messagesLoaded = true;
        const config = useAppConfig.getState();
        const globalModelConfig = config.modelConfig;

        if (mask) {
          session.mask = {
            ...mask,
            modelConfig: {
              ...globalModelConfig,
              ...mask.modelConfig,
            },
          };
          session.topic = mask.name;
        } else {
          session.mask.modelConfig = { ...globalModelConfig };
        }

        // Auto-fill providerId if missing
        if (!session.mask.modelConfig.providerId) {
          const { model, providerName } = session.mask.modelConfig;
          const providers = useProviderStore.getState().providers;
          const provider =
            providers.find(
              (p) =>
                p.enabled &&
                p.type.toLowerCase() === (providerName ?? "").toLowerCase() &&
                (p.models.includes(model) || p.models.length === 0),
            ) ?? providers.find((p) => p.enabled);
          if (provider) {
            session.mask.modelConfig.providerId = provider.id;
            session.mask.modelConfig.providerName = provider.type as any;
            if (
              provider.models.length > 0 &&
              !provider.models.includes(model)
            ) {
              session.mask.modelConfig.model = provider.models[0] as any;
            }
          }
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      async importSessionFromJson(
        data: unknown,
        fallbackTopic?: string,
        target: "local" | "cloud" = "local",
      ) {
        const normalizeMessage = (m: any): ChatMessage | null => {
          if (!m || typeof m !== "object") return null;
          const role =
            m.role === "user" || m.role === "assistant" || m.role === "system"
              ? m.role
              : "user";
          const content =
            typeof m.content === "string" || Array.isArray(m.content)
              ? m.content
              : "";
          const textContent = getMessageTextContent({
            role,
            content,
          } as ChatMessage).trim();
          if (!textContent && !Array.isArray(content)) return null;
          return createMessage({
            ...m,
            id: typeof m.id === "string" && m.id.length > 0 ? m.id : nanoid(),
            role,
            content,
            date:
              typeof m.date === "string" && m.date.length > 0
                ? m.date
                : new Date().toLocaleString(),
            streaming: false,
            isError: false,
          });
        };

        const source = data as any;
        const sourceMessages = Array.isArray(source)
          ? source
          : Array.isArray(source?.messages)
          ? source.messages
          : null;

        if (!sourceMessages || sourceMessages.length === 0) {
          showToast("导入失败：JSON 中未找到有效消息");
          return false;
        }

        const importedMessages = sourceMessages
          .map((m: any) => normalizeMessage(m))
          .filter(Boolean) as ChatMessage[];

        if (importedMessages.length === 0) {
          showToast("导入失败：消息格式不正确");
          return false;
        }

        const imported = createEmptySession();
        imported.topic =
          (typeof source?.topic === "string" && source.topic.trim()) ||
          fallbackTopic ||
          `导入会话 ${new Date().toLocaleString()}`;
        imported.messages = importedMessages;
        imported.messagesLoaded = true;
        imported.messageCount = importedMessages.length;
        imported.lastSummarizeIndex = 0;
        imported.memoryPrompt = "";
        imported.memoryHistory = [];
        const lastTs = new Date(importedMessages.at(-1)?.date ?? 0).getTime();
        imported.lastUpdate =
          Number.isFinite(lastTs) && lastTs > 0 ? lastTs : Date.now();

        const sanitized = sanitizeSession(imported);
        if (target === "cloud") {
          if (!isLoggedIn()) {
            showToast("导入云端失败：请先登录账号");
            return false;
          }
          await syncSessionMessagesToDB(sanitized, sanitized.messages);
          await syncSessionToDB(sanitized);
          await get().loadFromDB();
          showToast(`导入云端成功：${sanitized.messages.length} 条消息`);
          return true;
        }

        set((state) => ({
          sessions: [sanitized, ...state.sessions],
          currentSessionIndex: 0,
        }));
        showToast(`导入本地成功：${sanitized.messages.length} 条消息`);
        return true;
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index: number) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // for undo delete action
        const restoreState = {
          currentSessionIndex: get().currentSessionIndex,
          sessions: get().sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        deleteSessionFromDB(deletedSession.id);

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set(() => restoreState);
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message: ChatMessage, targetSession: ChatSession) {
        get().updateTargetSession(targetSession, (session) => {
          session.lastUpdate = Date.now();
        });

        get().updateStat(message, targetSession);

        get().checkMcpJson(message);

        get().summarizeSession(false, targetSession);
      },

      async onUserInput(
        content: string,
        attachImages?: string[],
        isMcpResponse?: boolean,
      ) {
        const session = get().currentSession();
        if (session.messagesLoaded === false) {
          showToast("消息加载中，请稍候...");
          return;
        }

        const modelConfig = session.mask.modelConfig;

        if (!modelConfig.model || !modelConfig.providerName) {
          showToast(
            "错误：尚未配置模型。请先在提供商列表中手动选择并配置一个主模型！",
          );
          return;
        }

        // MCP Response no need to fill template
        let mContent: string | MultimodalContent[] = isMcpResponse
          ? content
          : fillTemplateWith(content, modelConfig);

        if (!isMcpResponse && attachImages && attachImages.length > 0) {
          mContent = [
            ...(content ? [{ type: "text" as const, text: content }] : []),
            ...attachImages.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ];
        }

        let userMessage: ChatMessage = createMessage({
          role: "user",
          content: mContent,
          isMcpResponse,
        });

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
        });

        // get recent messages before writing to session to avoid sending userMessage twice
        const ctx = await get().getMessagesWithMemoryContext();
        userMessage.contextInfo = {
          sentCount: (ctx.sentHistoryMessages ?? []).length,
          contextPromptsCount: ctx.contextPromptsCount,
          hasLongTermMemory: ctx.hasLongTermMemory,
          memoryPrompt: ctx.memoryPrompt,
          historyMessages: ctx.sentHistoryMessages ?? [],
        };
        const sendMessages = ctx.messages.concat(userMessage);
        const messageIndex = session.messages.length + 2;

        // save user's and bot's message immediately so UI shows them
        get().updateTargetSession(
          session,
          (session) => {
            session.messages = session.messages.concat([
              { ...userMessage, content: mContent },
              botMessage,
            ]);
          },
          true,
        );
        // Persist user message immediately so abrupt tab close during streaming
        // does not lose newly sent input.
        const sessionAfterAppend =
          get().sessions.find((s) => s.id === session.id) ?? session;
        void syncSessionMessagesToDB(
          sessionAfterAppend,
          sessionAfterAppend.messages,
        );

        const matchedProvider = useProviderStore
          .getState()
          .providers.find(
            (p) =>
              p.enabled &&
              (modelConfig.providerId
                ? p.id === modelConfig.providerId
                : p.type === modelConfig.providerName &&
                  p.models.includes(modelConfig.model)),
          );
        const api = matchedProvider
          ? { llm: new ProviderStoreApi(matchedProvider) }
          : getClientApi(modelConfig.providerName);
        // make request
        api.llm.chat({
          messages: normalizeMessages(sendMessages),
          config: { ...modelConfig, stream: true },
          onUpdate(message) {
            botMessage.streaming = true;
            if (message) {
              botMessage.content = message;
            }
            get().updateTargetSession(
              session,
              (session) => {
                session.messages = session.messages.concat();
              },
              true,
            );
          },
          async onFinish(message) {
            botMessage.streaming = false;
            if (message) {
              botMessage.content = message;
              botMessage.date = new Date().toLocaleString();
            }
            get().updateTargetSession(
              session,
              (session) => {
                session.messages = session.messages.map((m) =>
                  m.id === botMessage.id ? { ...botMessage } : m,
                );
                session.lastUpdate = Date.now();
              },
              true,
            );
            if (message) get().updateStat(botMessage, session);
            get().checkMcpJson(botMessage);
            get().summarizeSession(
              false,
              get().sessions.find((s) => s.id === session.id) ?? session,
            );
            ChatControllerPool.remove(session.id, botMessage.id);
            const latestSession =
              get().sessions.find((s) => s.id === session.id) ?? session;
            // full sync so resend/truncate is reflected on server
            void syncSessionMessagesToDB(latestSession, latestSession.messages);
            // sync ASAP so other devices can see new messages quickly
            void flushSessionSyncQueue(session.id);
          },
          onBeforeTool(tool: ChatMessageTool) {
            (botMessage.tools = botMessage?.tools || []).push(tool);
            get().updateTargetSession(
              session,
              (session) => {
                session.messages = session.messages.concat();
              },
              true,
            );
          },
          onAfterTool(tool: ChatMessageTool) {
            botMessage?.tools?.forEach((t, i, tools) => {
              if (tool.id == t.id) {
                tools[i] = { ...tool };
              }
            });
            get().updateTargetSession(
              session,
              (session) => {
                session.messages = session.messages.concat();
              },
              true,
            );
          },
          onError(error) {
            const isAborted = error.message?.includes?.("aborted");
            botMessage.content +=
              "\n\n" +
              prettyObject({
                error: true,
                message: error.message,
              });
            botMessage.streaming = false;
            userMessage.isError = !isAborted;
            botMessage.isError = !isAborted;
            get().updateTargetSession(session, (session) => {
              session.messages = session.messages.concat();
            });
            ChatControllerPool.remove(
              session.id,
              botMessage.id ?? messageIndex,
            );

            console.error("[Chat] failed ", error);
          },
          onController(controller) {
            // collect controller for stop/retry
            ChatControllerPool.addController(
              session.id,
              botMessage.id ?? messageIndex,
              controller,
            );
          },
        });
      },

      getMemoryPrompt() {
        const session = get().currentSession();
        if (
          session.memoryPrompt.length &&
          session.lastSummarizeIndex <= session.messages.length
        ) {
          return {
            role: "system",
            content: Locale.Store.Prompt.History(session.memoryPrompt),
            date: "",
          } as ChatMessage;
        }
      },

      async getMessagesWithMemoryContext() {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.filter((m) => !m.streaming).slice();
        const totalMessageCount = session.messages.length;

        // in-context prompts
        const contextPrompts = session.mask.context.slice();

        const mcpEnabled = await isMcpEnabled();
        const mcpSystemPrompt = mcpEnabled ? await getMcpSystemPrompt() : "";

        let systemPrompts: ChatMessage[] = [];

        if (mcpEnabled) {
          systemPrompts = [
            createMessage({
              role: "system",
              content: mcpSystemPrompt,
            }),
          ];
          console.log("[Global System Prompt] ", mcpSystemPrompt);
        }
        const memoryPrompt = get().getMemoryPrompt();
        // long term memory
        const shouldSendLongTermMemory =
          modelConfig.sendMemory &&
          !!session.memoryPrompt &&
          session.memoryPrompt.length > 0 &&
          session.lastSummarizeIndex > clearContextIndex &&
          session.lastSummarizeIndex <= totalMessageCount;
        const longTermMemoryPrompts =
          shouldSendLongTermMemory && memoryPrompt ? [memoryPrompt] : [];

        // short term memory: always take the last N messages regardless of summarization
        const shortTermMemoryStartIndex = Math.max(
          0,
          totalMessageCount - modelConfig.historyMessageCount,
        );

        const contextStartIndex = Math.max(
          clearContextIndex,
          shortTermMemoryStartIndex,
        );

        const maxTokenThreshold = getAvailableContextTokens(
          modelConfig.model,
          modelConfig.max_tokens,
        );

        const reversedRecentMessages: ChatMessage[] = [];
        for (
          let i = totalMessageCount - 1, tokenCount = 0;
          i >= contextStartIndex && tokenCount < maxTokenThreshold;
          i -= 1
        ) {
          const msg = messages[i];
          if (!msg || msg.isError) continue;
          tokenCount += estimateTokenLength(getMessageTextContent(msg));
          reversedRecentMessages.push(msg);
        }

        // drop trailing assistant messages before reversing so history starts with user
        while (
          reversedRecentMessages.length > 0 &&
          reversedRecentMessages[reversedRecentMessages.length - 1].role ===
            "assistant"
        ) {
          reversedRecentMessages.pop();
        }

        const recentMessages = [
          ...systemPrompts,
          ...longTermMemoryPrompts,
          ...contextPrompts,
          ...reversedRecentMessages.reverse(),
        ];
        const sentHistoryMessages = reversedRecentMessages
          .map((m) => ({
            role: m.role,
            content: getMessageTextContent(m),
          }))
          .filter((m) => m.content.trim().length > 0);

        return {
          messages: recentMessages,
          sentHistoryCount: sentHistoryMessages.length,
          sentHistoryMessages,
          contextPromptsCount: contextPrompts.length,
          hasLongTermMemory: shouldSendLongTermMemory,
          memoryPrompt: shouldSendLongTermMemory ? session.memoryPrompt : "",
        };
      },

      async getMessagesWithMemory() {
        const ctx = await get().getMessagesWithMemoryContext();
        return ctx.messages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        set(() => ({ sessions }));
      },

      resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
      },

      summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ): Promise<void> {
        const config = useAppConfig.getState();
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        // skip summarize when using dalle3?
        if (isDalle3(modelConfig.model)) {
          return Promise.resolve();
        }

        // if not config compressModel, then using getSummarizeModel
        const compressProviderId = modelConfig.compressModel
          ? modelConfig.compressProviderId
          : modelConfig.providerId;
        const [model, providerName] = modelConfig.compressModel
          ? [modelConfig.compressModel, modelConfig.compressProviderName]
          : getSummarizeModel(
              session.mask.modelConfig.model,
              session.mask.modelConfig.providerName,
            );
        const summarizeProvider = useProviderStore
          .getState()
          .providers.find(
            (p) =>
              p.enabled &&
              (compressProviderId
                ? p.id === compressProviderId
                : p.type.toLowerCase() === (providerName ?? "").toLowerCase()),
          );
        const api: ClientApi = summarizeProvider
          ? ({
              llm: new ProviderStoreApi(summarizeProvider),
            } as unknown as ClientApi)
          : getClientApi(providerName as ServiceProvider);

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          (config.enableAutoGenerateTitle &&
            !session.customTopic &&
            session.topic === DEFAULT_TOPIC &&
            countMessages(messages) >= SUMMARIZE_MIN_LEN) ||
          refreshTitle
        ) {
          const startIndex = Math.max(
            0,
            messages.length - modelConfig.historyMessageCount,
          );
          const topicMessages = messages
            .slice(
              startIndex < messages.length ? startIndex : messages.length - 1,
              messages.length,
            )
            .concat(
              createMessage({
                role: "user",
                content: Locale.Store.Prompt.Topic,
              }),
            );
          const normalizedTopicMessages = normalizeMessages(topicMessages);
          return new Promise<void>((resolve) => {
            api.llm.chat({
              messages: normalizedTopicMessages,
              config: {
                model,
                stream: false,
                providerName,
                providerId: modelConfig.compressModel
                  ? modelConfig.compressProviderId
                  : modelConfig.providerId,
              },
              onFinish(message, responseRes) {
                if (
                  message &&
                  (responseRes == null || responseRes.status === 200)
                ) {
                  let topic = message;
                  try {
                    const parsed = JSON.parse(
                      message.replace(/^```json\s*|```$/g, "").trim(),
                    );
                    topic =
                      parsed?.cause?.name ??
                      parsed?.name ??
                      parsed?.title ??
                      message;
                  } catch {}
                  get().updateTargetSession(session, (session) => {
                    session.topic =
                      topic.length > 0 ? trimTopic(topic) : DEFAULT_TOPIC;
                    session.customTopic = false;
                  });
                }
                resolve();
              },
              onError() {
                resolve();
              },
            });
          });
        }
        const summarizeIndex = Math.max(
          session.lastSummarizeIndex,
          session.clearContextIndex ?? 0,
        );
        let effectiveSummarizeIndex = summarizeIndex;
        let toBeSummarizedMsgs = messages
          .filter((msg) => !msg.isError)
          .slice(summarizeIndex);

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (historyMsgLength > (modelConfig?.max_tokens || 4000)) {
          // Dynamically keep the longest contiguous prefix from summarizeIndex
          // that fits the model token budget, so summarized ranges stay continuous.
          const maxTokenBudget = modelConfig?.max_tokens || 4000;
          let tokenCount = 0;
          let keepCount = 0;
          for (let i = 0; i < toBeSummarizedMsgs.length; i += 1) {
            const msg = toBeSummarizedMsgs[i];
            const nextToken = estimateTokenLength(getMessageTextContent(msg));
            if (keepCount > 0 && tokenCount + nextToken > maxTokenBudget) break;
            tokenCount += nextToken;
            keepCount += 1;
          }
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
            0,
            Math.max(1, keepCount),
          );
          effectiveSummarizeIndex = summarizeIndex;
        }
        const memoryPrompt = get().getMemoryPrompt();
        const hasExistingMemory = !!memoryPrompt;
        if (memoryPrompt) {
          // add memory prompt as context, but track real message count separately
          toBeSummarizedMsgs.unshift(memoryPrompt);
        }
        // real message count excludes the virtual memoryPrompt message
        const realMsgCount = hasExistingMemory
          ? toBeSummarizedMsgs.length - 1
          : toBeSummarizedMsgs.length;

        console.log(
          "[Chat History] ",
          toBeSummarizedMsgs,
          historyMsgLength,
          modelConfig.compressMessageLengthThreshold,
        );

        if (
          historyMsgLength > modelConfig.compressMessageLengthThreshold &&
          modelConfig.sendMemory
        ) {
          summarizingSessionIds.add(session.id);
          set((s) => ({ summarizingIds: [...s.summarizingIds, session.id] }));
          /** Destruct max_tokens while summarizing
           * this param is just shit
           **/
          const { max_tokens, ...modelcfg } = modelConfig;
          api.llm.chat({
            messages: normalizeMessages(
              toBeSummarizedMsgs.concat(
                createMessage({
                  role: "user",
                  content: hasExistingMemory
                    ? Locale.Store.Prompt.SummarizeWithMemory
                    : Locale.Store.Prompt.Summarize,
                  date: "",
                }),
              ),
            ),
            config: {
              ...modelcfg,
              stream: true,
              model,
              providerName,
            },
            onUpdate(message) {
              session.memoryPrompt = message;
            },
            onFinish(message, responseRes) {
              summarizingSessionIds.delete(session.id);
              set((s) => ({
                summarizingIds: s.summarizingIds.filter(
                  (id) => id !== session.id,
                ),
              }));
              if (message && !message.includes('"error"')) {
                console.log("[Memory] ", message);
                get().updateTargetSession(session, (session) => {
                  // Advance only to the end of summarized range, not messages.length,
                  // so messages after the summarized range are still sent as short-term history.
                  session.lastSummarizeIndex =
                    effectiveSummarizeIndex + realMsgCount;
                  session.memoryPrompt = message;
                  session.memoryHistory = [
                    ...(session.memoryHistory ?? []),
                    {
                      summary: message,
                      fromIndex: effectiveSummarizeIndex,
                      toIndex: effectiveSummarizeIndex + realMsgCount,
                      isUpdate: hasExistingMemory,
                      createdAt: Date.now(),
                    },
                  ];
                  session.lastUpdate = Date.now();
                });
              }
            },
            onError(err) {
              summarizingSessionIds.delete(session.id);
              set((s) => ({
                summarizingIds: s.summarizingIds.filter(
                  (id) => id !== session.id,
                ),
              }));
              console.error("[Summarize] ", err);
            },
          });
        }
        return Promise.resolve();
      },

      updateStat(message: ChatMessage, session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
        });
      },
      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
        skipSync = false,
      ) {
        const sessions = get().sessions;
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index < 0) return;
        updater(sessions[index]);
        set(() => ({ sessions }));
        if (!skipSync) syncSessionToDB(sessions[index]);
      },
      async clearAllData() {
        clearAllSessionSyncTasks();
        await indexedDBStorage.clear();
        localStorage.clear();
        location.reload();
      },
      async loadFromDB() {
        set({ dbLoaded: false, dbLoadState: "loading" });
        if (!isLoggedIn()) {
          set({ dbLoaded: true, dbLoadState: "ready" });
          return;
        }
        try {
          const res = await fetchWithTimeout("/api/sessions");
          if (res.status === 401) {
            useUserStore.getState().logout();
            set({
              sessions: [createEmptySession()],
              currentSessionIndex: 0,
              dbLoaded: true,
              dbLoadState: "ready",
            });
            return;
          }
          if (!res.ok) {
            set({ dbLoaded: true, dbLoadState: "error" });
            return;
          }
          const rows = await res.json();
          const localSessions = sanitizeSessions(get().sessions).filter(
            isMeaningfulSession,
          );
          if (!Array.isArray(rows) || rows.length === 0) {
            set({
              sessions: [createEmptySession()],
              dbLoaded: true,
              dbLoadState: "ready",
            });
            return;
          }
          const isEmptyDefaultSession = (r: any) =>
            r?.title === DEFAULT_TOPIC && (r?.message_count ?? 0) <= 0;
          const filteredRows = rows.filter(
            (r: any) => !isEmptyDefaultSession(r),
          );
          // Only clean up truly empty default sessions.
          // Keep default-titled sessions when they already contain messages.
          rows
            .filter((r: any) => isEmptyDefaultSession(r))
            .forEach((r: any) => deleteSessionFromDB(r.id));
          if (!filteredRows.length) {
            set({
              sessions: [createEmptySession()],
              dbLoaded: true,
              dbLoadState: "ready",
            });
            return;
          }
          const hidden = new Set<string>(get().hiddenSessionIds ?? []);
          const providers = useProviderStore.getState().providers;
          const localSessionMap = new Map(localSessions.map((s) => [s.id, s]));
          const cloudSessions: ChatSession[] = filteredRows
            .filter((r: any) => !hidden.has(r.id))
            .map((r: any) => {
              const local = localSessionMap.get(r.id);
              const localMessages =
                local?.messages && local.messages.length > 0
                  ? local.messages
                  : [];
              const cloudMessageCount = r.message_count ?? 0;
              const cloudLastMessageId = r.last_message_id ?? "";
              const cloudUpdatedAt = new Date(r.updated_at).getTime();
              const localUpdatedAt = local?.lastUpdate ?? 0;
              const localLastMessageId =
                localMessages.length > 0
                  ? localMessages[localMessages.length - 1]?.id ?? ""
                  : "";
              const localIsAhead =
                localMessages.length > cloudMessageCount &&
                localUpdatedAt > cloudUpdatedAt;
              const localMatchesCloud =
                localMessages.length > 0 &&
                localMessages.length === cloudMessageCount &&
                (cloudLastMessageId
                  ? localLastMessageId === cloudLastMessageId
                  : true);
              const shouldReuseLocalMessages =
                localIsAhead || localMatchesCloud;
              const session = {
                ...createEmptySession(),
                id: r.id,
                topic: r.title,
                messages: shouldReuseLocalMessages ? localMessages : [],
                messagesLoaded: shouldReuseLocalMessages,
                messageCount: localIsAhead
                  ? localMessages.length
                  : cloudMessageCount,
                mask: r.mask ?? createEmptyMask(),
                memoryPrompt: r.memory_prompt ?? "",
                memoryHistory: r.memory_history ?? [],
                lastSummarizeIndex: r.last_summarize_index ?? 0,
                lastUpdate: cloudUpdatedAt,
              };
              // Auto-fill providerId if missing
              if (!session.mask.modelConfig.providerId) {
                const { model, providerName } = session.mask.modelConfig;
                const provider =
                  providers.find(
                    (p) =>
                      p.enabled &&
                      p.type.toLowerCase() ===
                        (providerName ?? "").toLowerCase() &&
                      p.models.includes(model),
                  ) ??
                  providers.find(
                    (p) =>
                      p.enabled &&
                      p.type.toLowerCase() ===
                        (providerName ?? "").toLowerCase(),
                  ) ??
                  providers.find((p) => p.enabled);
                if (provider) {
                  session.mask.modelConfig.providerId = provider.id;
                  if (provider.type !== providerName)
                    session.mask.modelConfig.providerName =
                      provider.type as any;
                }
              }
              return session;
            });

          // Cloud is authoritative.
          const allSessions = sanitizeSessions(cloudSessions);

          const prevCurrentId = get().currentSession()?.id;
          const mergedCurrentIndex = prevCurrentId
            ? allSessions.findIndex((s) => s.id === prevCurrentId)
            : -1;
          set({
            sessions: allSessions,
            currentSessionIndex:
              mergedCurrentIndex >= 0 ? mergedCurrentIndex : 0,
            dbLoaded: true,
            dbLoadState: "ready",
          });

          // 预取第一个 session 的消息，避免等待 React 渲染周期
          if (
            allSessions.length > 0 &&
            allSessions[0].messagesLoaded === false
          ) {
            void get().loadSessionMessages(allSessions[0].id);
          }
        } catch (e) {
          console.error("[Chat] failed to load sessions from db", e);
          set({ dbLoaded: true, dbLoadState: "error" });
        }
      },
      setLastInput(lastInput: string) {
        set({
          lastInput,
        });
      },

      async loadSessionMessages(sessionId: string, force = false) {
        const index = get().sessions.findIndex((s) => s.id === sessionId);
        if (index < 0) return;
        if (!force && get().sessions[index].messagesLoaded) return;
        try {
          const res = await fetchWithTimeout(`/api/sessions/${sessionId}`);
          if (res.status === 401) {
            useUserStore.getState().logout();
            throw new Error("unauthorized");
          }
          if (!res.ok) throw new Error(`load failed: ${res.status}`);
          const row = await res.json();
          const nextMessages: ChatMessage[] = (row as any)?.messages ?? [];
          const cloudIds = new Set(nextMessages.map((m) => m.id));
          let localAhead = false;
          set((state) => {
            const idx = state.sessions.findIndex((s) => s.id === sessionId);
            if (idx < 0) return state;
            const current = state.sessions[idx];
            const localLastId =
              current.messages.length > 0
                ? current.messages[current.messages.length - 1]?.id ?? ""
                : "";
            localAhead = localLastId !== "" && !cloudIds.has(localLastId);
            const updated = [...state.sessions];
            updated[idx] = {
              ...current,
              messages: localAhead ? current.messages : nextMessages,
              messagesLoaded: true,
              messageCount: localAhead
                ? current.messages.length
                : nextMessages.length,
            };
            return { sessions: updated };
          });
          // If local was ahead, push local messages to cloud immediately
          if (localAhead) {
            const finalSession = get().sessions.find((s) => s.id === sessionId);
            if (finalSession) {
              void syncSessionMessagesToDB(finalSession, finalSession.messages);
            }
          }
        } catch (e) {
          console.error("[Chat] failed to load session messages", e);
          set((state) => {
            const idx = state.sessions.findIndex((s) => s.id === sessionId);
            if (idx < 0) return state;
            const updated = [...state.sessions];
            updated[idx] = {
              ...updated[idx],
              messagesLoaded: true,
            };
            return { sessions: updated };
          });
        }
      },

      /** check if the message contains MCP JSON and execute the MCP action */
      checkMcpJson(message: ChatMessage) {
        const mcpEnabled = isMcpEnabled();
        if (!mcpEnabled) return;
        const content = getMessageTextContent(message);
        if (isMcpJson(content)) {
          try {
            const mcpRequest = extractMcpJson(content);
            if (mcpRequest) {
              console.debug("[MCP Request]", mcpRequest);

              executeMcpAction(mcpRequest.clientId, mcpRequest.mcp)
                .then((result) => {
                  console.log("[MCP Response]", result);
                  const mcpResponse =
                    typeof result === "object"
                      ? JSON.stringify(result)
                      : String(result);
                  get().onUserInput(
                    `\`\`\`json:mcp-response:${mcpRequest.clientId}\n${mcpResponse}\n\`\`\``,
                    [],
                    true,
                  );
                })
                .catch((error) => showToast("MCP execution failed", error));
            }
          } catch (error) {
            console.error("[Check MCP JSON]", error);
          }
        }
      },
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 3.3,
    migrate(persistedState, version) {
      const state = persistedState as any;
      const newState = JSON.parse(
        JSON.stringify(state),
      ) as typeof DEFAULT_CHAT_STATE;

      if (version < 2) {
        newState.sessions = [];

        const oldSessions = state.sessions;
        for (const oldSession of oldSessions) {
          const newSession = createEmptySession();
          newSession.topic = oldSession.topic;
          newSession.messages = [...oldSession.messages];
          newSession.mask.modelConfig.sendMemory = true;
          newSession.mask.modelConfig.historyMessageCount = 4;
          newSession.mask.modelConfig.compressMessageLengthThreshold = 1000;
          newState.sessions.push(newSession);
        }
      }

      if (version < 3) {
        // migrate id to nanoid
        newState.sessions.forEach((s) => {
          s.id = nanoid();
          s.messages.forEach((m) => (m.id = nanoid()));
        });
      }

      // Enable `enableInjectSystemPrompts` attribute for old sessions.
      // Resolve issue of old sessions not automatically enabling.
      if (version < 3.1) {
        // enableInjectSystemPrompts removed, skip
      }

      // add default summarize model for every session
      if (version < 3.2) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = config.modelConfig.compressModel;
          s.mask.modelConfig.compressProviderName =
            config.modelConfig.compressProviderName;
        });
      }
      // revert default summarize model for every session
      if (version < 3.3) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = "";
          s.mask.modelConfig.compressProviderName = "";
        });
      }

      newState.sessions = sanitizeSessions(newState.sessions as ChatSession[]);
      newState.hiddenSessionIds = Array.isArray(
        (newState as any).hiddenSessionIds,
      )
        ? (newState as any).hiddenSessionIds.filter(
            (x: any) => typeof x === "string",
          )
        : [];
      if (
        typeof newState.currentSessionIndex !== "number" ||
        newState.currentSessionIndex < 0 ||
        newState.currentSessionIndex >= newState.sessions.length
      ) {
        newState.currentSessionIndex = 0;
      }
      return newState as any;
    },
    partialize: (state) => {
      const { dbLoaded, dbLoadState, ...rest } = state as any;
      return rest;
    },
  },
);
