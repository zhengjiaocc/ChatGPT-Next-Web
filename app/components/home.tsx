"use client";

require("../polyfill");

import { useEffect, useState } from "react";
import styles from "./home.module.scss";

import BotIcon from "../icons/bot.svg";
import LoadingIcon from "../icons/three-dots.svg";

import { getCSSVar, useMobileScreen } from "../utils";

import dynamic from "next/dynamic";
import { Path, SlotID } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang, getLang } from "../locales";

import {
  HashRouter as Router,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { SideBar } from "./sidebar";
import { useAppConfig } from "../store/config";
import { LoginPage } from "./login";
import { getClientConfig } from "../config/client";
import { type ClientApi, getClientApi } from "../client/api";
import { useChatStore, useAccessStore } from "../store";
import { useProviderStore } from "../store/provider";
import { useUserStore } from "../store/user";
import clsx from "clsx";
import { initializeMcpSystem, isMcpEnabled } from "../mcp/actions";

const INIT_LOAD_TIMEOUT = 10_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timeoutId));
  });
}

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={clsx("no-dark", styles["loading-content"])}>
      {!props.noLogo && <BotIcon />}
      <LoadingIcon />
    </div>
  );
}

const Artifacts = dynamic(async () => (await import("./artifacts")).Artifacts, {
  loading: () => <Loading noLogo />,
});

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const Chat = dynamic(async () => (await import("./chat")).Chat, {
  loading: () => <Loading noLogo />,
  ssr: false,
});

const NewChat = dynamic(async () => (await import("./new-chat")).NewChat, {
  loading: () => <Loading noLogo />,
});

const MaskPage = dynamic(async () => (await import("./mask")).MaskPage, {
  loading: () => <Loading noLogo />,
});

const PluginPage = dynamic(async () => (await import("./plugin")).PluginPage, {
  loading: () => <Loading noLogo />,
});

const SearchChat = dynamic(
  async () => (await import("./search-chat")).SearchChatPage,
  {
    loading: () => <Loading noLogo />,
  },
);

const Sd = dynamic(async () => (await import("./sd")).Sd, {
  loading: () => <Loading noLogo />,
});

const McpMarketPage = dynamic(
  async () => (await import("./mcp-market")).McpMarketPage,
  {
    loading: () => <Loading noLogo />,
  },
);

export function useSwitchTheme() {
  const config = useAppConfig();

  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (config.theme === "dark") {
      document.body.classList.add("dark");
    } else if (config.theme === "light") {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (config.theme === "auto") {
      metaDescriptionDark?.setAttribute("content", "#151515");
      metaDescriptionLight?.setAttribute("content", "#fafafa");
    } else {
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    }
  }, [config.theme]);
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

const loadAsyncGoogleFont = () => {
  const linkEl = document.createElement("link");
  const proxyFontUrl = "/google-fonts";
  const remoteFontUrl = "https://fonts.googleapis.com";
  const googleFontUrl =
    getClientConfig()?.buildMode === "export" ? remoteFontUrl : proxyFontUrl;
  linkEl.rel = "stylesheet";
  linkEl.href =
    googleFontUrl +
    "/css2?family=" +
    encodeURIComponent("Noto Sans:wght@300;400;700;900") +
    "&display=swap";
  document.head.appendChild(linkEl);
};

export function WindowContent(props: { children: React.ReactNode }) {
  return (
    <div className={styles["window-content"]} id={SlotID.AppBody}>
      {props?.children}
    </div>
  );
}

function Screen() {
  const config = useAppConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const userStore = useUserStore();
  const isArtifact = location.pathname.includes(Path.Artifacts);
  const isHome = location.pathname === Path.Home;
  const isLogin = location.pathname === Path.Login;
  const isSd = location.pathname === Path.Sd;
  const isSdNew = location.pathname === Path.SdNew;

  const isMobileScreen = useMobileScreen();
  const shouldTightBorder =
    getClientConfig()?.isApp || (config.tightBorder && !isMobileScreen);

  useEffect(() => {
    loadAsyncGoogleFont();
  }, []);

  useEffect(() => {
    if (isLogin || getClientConfig()?.isApp) return;
    if (!userStore.loggedIn) {
      navigate(Path.Login);
    }
  }, [isLogin, navigate, userStore.loggedIn]);

  if (isArtifact) {
    return (
      <Routes>
        <Route path="/artifacts/:id" element={<Artifacts />} />
      </Routes>
    );
  }
  const renderContent = () => {
    if (isSd) return <Sd />;
    if (isSdNew) return <Sd />;
    return (
      <>
        <SideBar
          className={clsx({
            [styles["sidebar-show"]]: isHome,
          })}
        />
        <WindowContent>
          <Routes>
            <Route path={Path.Home} element={<Chat />} />
            <Route path={Path.NewChat} element={<NewChat />} />
            <Route path={Path.Masks} element={<MaskPage />} />
            <Route path={Path.Plugins} element={<PluginPage />} />
            <Route path={Path.SearchChat} element={<SearchChat />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.Settings} element={<Settings />} />
            <Route path={Path.McpMarket} element={<McpMarketPage />} />
          </Routes>
        </WindowContent>
      </>
    );
  };

  if (isLogin) return <LoginPage />;

  return (
    <div
      className={clsx(styles.container, {
        [styles["tight-container"]]: shouldTightBorder,
        [styles["rtl-screen"]]: getLang() === "ar",
      })}
    >
      {renderContent()}
    </div>
  );
}

// 已切除旧版强行获取公版模型库列表的抢跑钩子 (useLoadData)

export function Home() {
  useSwitchTheme();
  useHtmlLang();
  const userStore = useUserStore();

  useEffect(() => {
    console.log("[Config] got config from build time", getClientConfig());
    useAccessStore.getState().fetch();

    const initMcp = async () => {
      try {
        const enabled = await isMcpEnabled();
        if (enabled) {
          console.log("[MCP] initializing...");
          await initializeMcpSystem();
          console.log("[MCP] initialized");
        }
      } catch (err) {
        console.error("[MCP] failed to initialize:", err);
      }
    };
    initMcp();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadUserData = async () => {
      try {
        const totalStart = performance.now();
        if (!userStore.loggedIn) {
          useChatStore.setState({ dbLoaded: true, dbLoadState: "ready" });
          console.debug("[Init] guest mode ready");
          return;
        }

        // Logged-in mode uses cloud as source of truth.
        useChatStore.getState().clearSessions();
        useProviderStore.setState({ providers: [] });
        useAppConfig.getState().reset();

        const providerStart = performance.now();
        const providerTask = withTimeout(
          useProviderStore.getState().loadFromDB(),
          INIT_LOAD_TIMEOUT,
        );
        const configTask = withTimeout(
          useAppConfig.getState().loadFromDB(),
          INIT_LOAD_TIMEOUT,
        );
        await Promise.allSettled([providerTask, configTask]);
        const sharedLoadedAt = performance.now();
        console.debug(
          "[Init] shared stores loaded in",
          Math.round(sharedLoadedAt - providerStart),
          "ms",
        );

        if (cancelled) return;
        const chatStart = performance.now();
        await useChatStore.getState().loadFromDB();
        const chatLoadedAt = performance.now();
        console.debug(
          "[Init] chat sessions loaded in",
          Math.round(chatLoadedAt - chatStart),
          "ms",
        );
        console.debug(
          "[Init] total ready in",
          Math.round(chatLoadedAt - totalStart),
          "ms",
        );
      } catch (e) {
        console.error("[Home] failed to initialize user data", e);
        useChatStore.setState({ dbLoaded: true, dbLoadState: "error" });
      }
    };

    loadUserData();

    return () => {
      cancelled = true;
    };
  }, [userStore.loggedIn]);

  return (
    <ErrorBoundary>
      <Router>
        <Screen />
      </Router>
    </ErrorBoundary>
  );
}

export default Home;
