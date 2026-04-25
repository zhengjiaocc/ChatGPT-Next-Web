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

export interface ChatSession {
  id: string;
  topic: string;
  customTopic?: boolean;

  memoryPrompt: string;
  memoryHistory: string[];
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
  messagesLoaded?: boolean;
  messageCount?: number;
  /**
   * Whether this session is stale compared to remote (updated elsewhere).
   * Used to gate sending so model context stays consistent.
   */
  isStale?: boolean;
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
  memoryHistory: string[];
  lastSummarizeIndex: number;
};

const SESSION_SYNC_DEBOUNCE_MS = 500;
const sessionSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSessionSyncPayload = new Map<string, SessionSyncPayload>();
const sessionSyncRunning = new Map<string, boolean>();
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
  };
}

function isMeaningfulSession(session?: ChatSession) {
  if (!session) return false;
  return session.messages.length > 0 || session.topic !== DEFAULT_TOPIC;
}

function getSessionMessageCount(session: ChatSession) {
  return session.messagesLoaded === false
    ? session.messageCount ?? 0
    : session.messages.length;
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

function getPersistableMessageCount(session: ChatSession) {
  if (session.messagesLoaded === false) return session.messageCount ?? 0;
  return getPersistableMessages(session).length;
}

function getPersistableLastMessageId(session: ChatSession) {
  if (session.messagesLoaded === false) return "";
  return getPersistableMessages(session).at(-1)?.id ?? "";
}

function debugLog(...args: any[]) {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production")
    return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

function shouldPreferLocalSession(local: ChatSession, cloud: ChatSession) {
  const localTs = local.lastUpdate || 0;
  const cloudTs = cloud.lastUpdate || 0;
  // Timestamp wins first (allow tiny clock drifts).
  if (localTs > cloudTs + 1000) return true;
  if (cloudTs > localTs + 1000) return false;

  // If timestamps are close, prefer the one that has more visible messages.
  const localCount = getSessionMessageCount(local);
  const cloudCount = getSessionMessageCount(cloud);
  if (localCount !== cloudCount) return localCount > cloudCount;

  // Final fallback: prefer loaded local messages to avoid losing recent unsynced turns.
  if (local.messagesLoaded !== false && cloud.messagesLoaded === false)
    return true;
  return false;
}

function sanitizeSession(session: ChatSession): ChatSession {
  const fixed = { ...session };
  fixed.isStale = false;
  const seenMessageIds = new Set<string>();
  fixed.messages = (session.messages ?? []).filter((m) => {
    const id = m?.id;
    if (!id) return false;
    if (seenMessageIds.has(id)) return false;
    seenMessageIds.add(id);
    return true;
  });

  fixed.lastSummarizeIndex = Math.max(
    0,
    Math.min(fixed.lastSummarizeIndex ?? 0, fixed.messages.length),
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
      shouldPreferLocalSession(session, existed) ? session : existed,
    );
  }

  const normalized = Array.from(byId.values())
    .filter(isMeaningfulSession)
    .sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0));

  return normalized.length > 0 ? normalized : [createEmptySession()];
}

async function syncSessionPayloadToDB(
  payload: SessionSyncPayload,
  retries = 3,
) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetchWithTimeout(
        `/api/sessions/${encodeURIComponent(payload.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (res.ok) return true;
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
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    return navigator.sendBeacon(
      `/api/sessions/${encodeURIComponent(payload.id)}`,
      blob,
    );
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
  const appendMessages = messages.filter(
    (m) =>
      !!m?.id &&
      !m.streaming &&
      !m.isError &&
      getMessageTextContent(m).trim().length > 0,
  );
  if (appendMessages.length === 0) return;
  try {
    await fetchWithTimeout(`/api/sessions/${session.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: session.topic,
        messages: appendMessages,
        model: session.mask.modelConfig.model,
        mask: session.mask,
        memoryPrompt: session.memoryPrompt,
        memoryHistory: session.memoryHistory ?? [],
        lastSummarizeIndex: session.lastSummarizeIndex,
      }),
    });
  } catch (e) {
    console.error("[Sync] failed to append session messages", e);
  }
}

async function deleteSessionFromDB(id: string) {
  if (!isLoggedIn()) return;
  const timer = sessionSyncTimers.get(id);
  if (timer) clearTimeout(timer);
  sessionSyncTimers.delete(id);
  pendingSessionSyncPayload.delete(id);
  sessionSyncRunning.delete(id);
  await fetch("/api/sessions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

const DEFAULT_CHAT_STATE = {
  sessions: [createEmptySession()],
  currentSessionIndex: 0,
  lastInput: "",
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

        const refreshCurrentSession = async () => {
          debugLog("[StaleGate] refresh clicked", {
            sessionId: session.id,
            localTs: session.lastUpdate || 0,
            localPersistableCount: getPersistableMessageCount(session),
            localPersistableLastId: getPersistableLastMessageId(session),
            messagesLoaded: session.messagesLoaded !== false,
          });
          try {
            // Force-reload current session messages and clear stale flag.
            await get().loadSessionMessages(session.id, true);
            get().updateTargetSession(
              session,
              (s) => {
                s.isStale = false;
              },
              true,
            );
            const latest =
              get().sessions.find((s) => s.id === session.id) ?? session;
            debugLog("[StaleGate] refresh done", {
              sessionId: latest.id,
              localTs: latest.lastUpdate || 0,
              localPersistableCount: getPersistableMessageCount(latest),
              localPersistableLastId: getPersistableLastMessageId(latest),
              messagesLoaded: latest.messagesLoaded !== false,
              isStale: latest.isStale ?? false,
            });
          } catch {
            location.reload();
          }
        };

        // If the session is already known stale, block sending and ask user to refresh.
        if (session.isStale) {
          debugLog("[StaleGate] blocked: already stale", {
            sessionId: session.id,
            localTs: session.lastUpdate || 0,
            localPersistableCount: getPersistableMessageCount(session),
            localPersistableLastId: getPersistableLastMessageId(session),
          });
          showToast("该会话已在其他设备更新，请先刷新后再发送。", {
            text: "刷新",
            onClick: () => void refreshCurrentSession(),
          });
          return;
        }

        // Before sending: check if remote has newer updates (1 extra request).
        if (isLoggedIn() && session.id) {
          try {
            const res = await fetchWithTimeout(
              `/api/sessions/${encodeURIComponent(session.id)}?meta=1`,
              undefined,
              6000,
            );
            if (res.status === 401) {
              useUserStore.getState().logout();
              showToast("登录状态已失效，请重新登录");
              return;
            }
            if (res.ok) {
              const meta = (await res.json()) as any;
              const remoteTs = new Date(meta?.updated_at ?? 0).getTime();
              const remoteCount = Number(meta?.message_count ?? 0);
              const remoteLastId = String(meta?.last_message_id ?? "");
              const localCount = getPersistableMessageCount(session);
              const localLastId = getPersistableLastMessageId(session);

              // Stale detection primarily by message id.
              // Fallback to count only when remote id is unavailable.
              const hasRemoteLastId = remoteLastId.length > 0;
              const lastIdMismatch =
                hasRemoteLastId &&
                !!localLastId &&
                remoteLastId !== localLastId;
              const countAhead =
                Number.isFinite(remoteCount) && remoteCount > localCount;
              const remoteNewer = hasRemoteLastId ? lastIdMismatch : countAhead;

              debugLog("[StaleGate] meta check", {
                sessionId: session.id,
                remoteTs,
                remoteCount,
                remoteLastId,
                localCount,
                localLastId,
                hasRemoteLastId,
                lastIdMismatch,
                remoteNewer,
                // messagesLoaded is guaranteed here (checked at function start)
                messagesLoaded: true,
                localTailIds: getPersistableMessages(session)
                  .slice(-5)
                  .map((m) => m.id),
              });
              if (remoteNewer) {
                get().updateTargetSession(
                  session,
                  (s) => {
                    s.isStale = true;
                    // Keep a hint so list rendering can reflect remote count.
                    if (s.messagesLoaded === false)
                      s.messageCount = Math.max(
                        s.messageCount ?? 0,
                        remoteCount,
                      );
                    if (Number.isFinite(remoteTs) && remoteTs > 0)
                      s.lastUpdate = Math.max(s.lastUpdate || 0, remoteTs);
                  },
                  true,
                );
                debugLog("[StaleGate] marked stale", { sessionId: session.id });
                showToast("该会话已在其他设备更新，请先刷新后再发送。", {
                  text: "刷新",
                  onClick: () => void refreshCurrentSession(),
                });
                return;
              }
            }
          } catch {
            // best-effort; ignore
          }
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
          sentCount: ctx.sentHistoryCount,
          contextPromptsCount: ctx.contextPromptsCount,
          hasLongTermMemory: ctx.hasLongTermMemory,
          memoryPrompt: ctx.memoryPrompt,
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
            // append-only sync for the newly completed round
            void syncSessionMessagesToDB(latestSession, [
              userMessage,
              botMessage,
            ]);
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

        if (session.memoryPrompt.length) {
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
          session.lastSummarizeIndex > clearContextIndex;
        const longTermMemoryPrompts =
          shouldSendLongTermMemory && memoryPrompt ? [memoryPrompt] : [];
        const longTermMemoryStartIndex = session.lastSummarizeIndex;

        // short term memory
        const shortTermMemoryStartIndex = Math.max(
          0,
          totalMessageCount - modelConfig.historyMessageCount,
        );

        // keep same start-index semantics with getMessagesWithMemory
        const memoryStartIndex = shouldSendLongTermMemory
          ? Math.min(longTermMemoryStartIndex, shortTermMemoryStartIndex)
          : shortTermMemoryStartIndex;
        const contextStartIndex = Math.max(clearContextIndex, memoryStartIndex);

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

        const recentMessages = [
          ...systemPrompts,
          ...longTermMemoryPrompts,
          ...contextPrompts,
          ...reversedRecentMessages.reverse(),
        ];

        return {
          messages: recentMessages,
          sentHistoryCount: reversedRecentMessages.length,
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
        let toBeSummarizedMsgs = messages
          .filter((msg) => !msg.isError)
          .slice(summarizeIndex);

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (historyMsgLength > (modelConfig?.max_tokens || 4000)) {
          const n = toBeSummarizedMsgs.length;
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(Math.max(0, n - 20));
        }
        const memoryPrompt = get().getMemoryPrompt();
        if (memoryPrompt) {
          // add memory prompt
          toBeSummarizedMsgs.unshift(memoryPrompt);
        }

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
          /** Destruct max_tokens while summarizing
           * this param is just shit
           **/
          const { max_tokens, ...modelcfg } = modelConfig;
          api.llm.chat({
            messages: normalizeMessages(
              toBeSummarizedMsgs.concat(
                createMessage({
                  role: "system",
                  content: Locale.Store.Prompt.Summarize,
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
              if (message && !message.includes('"error"')) {
                console.log("[Memory] ", message);
                get().updateTargetSession(session, (session) => {
                  session.lastSummarizeIndex = session.messages.length;
                  session.memoryPrompt = message;
                  session.memoryHistory = [
                    ...(session.memoryHistory ?? []),
                    message,
                  ];
                });
              }
            },
            onError(err) {
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
            if (localSessions.length > 0) {
              const sessions = sanitizeSessions(localSessions);
              const prevCurrentId = get().currentSession()?.id;
              const localCurrentIndex = prevCurrentId
                ? sessions.findIndex((s) => s.id === prevCurrentId)
                : -1;
              set({
                sessions,
                currentSessionIndex:
                  localCurrentIndex >= 0 ? localCurrentIndex : 0,
                dbLoaded: true,
                dbLoadState: "ready",
              });
              sessions.forEach((session) => {
                if (isMeaningfulSession(session)) {
                  void syncSessionMessagesToDB(session, session.messages);
                  void syncSessionToDB(session);
                }
              });
            } else {
              set({
                sessions: [createEmptySession()],
                dbLoaded: true,
                dbLoadState: "ready",
              });
            }
            return;
          }
          const filteredRows = rows.filter(
            (r: any) => (r.message_count ?? 0) > 0 || r.title !== DEFAULT_TOPIC,
          );
          // Clean up empty sessions from DB
          rows
            .filter((r: any) => !filteredRows.includes(r))
            .forEach((r: any) => deleteSessionFromDB(r.id));
          if (!filteredRows.length) {
            if (localSessions.length > 0) {
              const sessions = sanitizeSessions(localSessions);
              const prevCurrentId = get().currentSession()?.id;
              const localCurrentIndex = prevCurrentId
                ? sessions.findIndex((s) => s.id === prevCurrentId)
                : -1;
              set({
                sessions,
                currentSessionIndex:
                  localCurrentIndex >= 0 ? localCurrentIndex : 0,
                dbLoaded: true,
                dbLoadState: "ready",
              });
              sessions.forEach((session) => {
                if (isMeaningfulSession(session)) {
                  void syncSessionMessagesToDB(session, session.messages);
                  void syncSessionToDB(session);
                }
              });
            } else {
              set({
                sessions: [createEmptySession()],
                dbLoaded: true,
                dbLoadState: "ready",
              });
            }
            return;
          }
          const providers = useProviderStore.getState().providers;
          const cloudSessions: ChatSession[] = filteredRows.map((r: any) => {
            const session = {
              ...createEmptySession(),
              id: r.id,
              topic: r.title,
              messages: [],
              messagesLoaded: false as const,
              messageCount: r.message_count ?? 0,
              isStale: false,
              mask: r.mask ?? createEmptyMask(),
              memoryPrompt: r.memory_prompt ?? "",
              memoryHistory: r.memory_history ?? [],
              lastSummarizeIndex: r.last_summarize_index ?? 0,
              lastUpdate: new Date(r.updated_at).getTime(),
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
                    p.type.toLowerCase() === (providerName ?? "").toLowerCase(),
                ) ??
                providers.find((p) => p.enabled);
              if (provider) {
                session.mask.modelConfig.providerId = provider.id;
                if (provider.type !== providerName)
                  session.mask.modelConfig.providerName = provider.type as any;
              }
            }
            return session;
          });

          // Merge cloud sessions with hydrated local sessions.
          // This prevents cloud stale snapshots from overriding recent local turns.
          const mergedById = new Map<
            string,
            { session: ChatSession; localPreferred: boolean }
          >();
          for (const s of cloudSessions) {
            mergedById.set(s.id, { session: s, localPreferred: false });
          }

          for (const local of localSessions) {
            const existed = mergedById.get(local.id);
            if (!existed) {
              mergedById.set(local.id, {
                session: local,
                localPreferred: true,
              });
              continue;
            }
            if (shouldPreferLocalSession(local, existed.session)) {
              mergedById.set(local.id, {
                session: local,
                localPreferred: true,
              });
            }
          }

          const sessions = sanitizeSessions(
            Array.from(mergedById.values())
              .map((v) => v.session)
              .sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0)),
          );

          const prevCurrentId = get().currentSession()?.id;
          const mergedCurrentIndex = prevCurrentId
            ? sessions.findIndex((s) => s.id === prevCurrentId)
            : -1;
          set({
            sessions,
            currentSessionIndex:
              mergedCurrentIndex >= 0 ? mergedCurrentIndex : 0,
            dbLoaded: true,
            dbLoadState: "ready",
          });

          // Push local-preferred merged sessions back to cloud ASAP.
          mergedById.forEach(({ session, localPreferred }) => {
            if (localPreferred && isMeaningfulSession(session)) {
              void syncSessionMessagesToDB(session, session.messages);
              void syncSessionToDB(session);
            }
          });

          // 预取第一个 session 的消息，避免等待 React 渲染周期
          if (sessions.length > 0) {
            void get().loadSessionMessages(sessions[0].id);
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
          debugLog("[Session] loadSessionMessages start", { sessionId, force });
          const res = await fetchWithTimeout(`/api/sessions/${sessionId}`);
          if (res.status === 401) {
            useUserStore.getState().logout();
            throw new Error("unauthorized");
          }
          if (!res.ok) throw new Error(`load failed: ${res.status}`);
          const row = await res.json();
          set((state) => {
            const idx = state.sessions.findIndex((s) => s.id === sessionId);
            if (idx < 0) return state;
            const updated = [...state.sessions];
            const remoteTs = new Date((row as any)?.updated_at ?? 0).getTime();
            const nextMessages = (row as any)?.messages ?? [];
            updated[idx] = {
              ...updated[idx],
              messages: nextMessages,
              messagesLoaded: true,
              isStale: false,
              messageCount: Array.isArray(nextMessages)
                ? nextMessages.length
                : updated[idx].messageCount,
              lastUpdate:
                Number.isFinite(remoteTs) && remoteTs > 0
                  ? remoteTs
                  : updated[idx].lastUpdate,
            };
            return { sessions: updated };
          });
          debugLog("[Session] loadSessionMessages ok", {
            sessionId,
            remoteTs: new Date((row as any)?.updated_at ?? 0).getTime(),
            remoteCount: Array.isArray((row as any)?.messages)
              ? (row as any).messages.length
              : undefined,
            remoteLastId: Array.isArray((row as any)?.messages)
              ? (row as any).messages.at(-1)?.id
              : undefined,
          });
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
