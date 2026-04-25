import React, {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./home.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import ChatGptIcon from "../icons/chatgpt.svg";
import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/delete.svg";
import DarkIcon from "../icons/dark.svg";
import LightIcon from "../icons/light.svg";
import AutoIcon from "../icons/auto.svg";
import MaskIcon from "../icons/mask.svg";
import McpIcon from "../icons/mcp.svg";
import DragIcon from "../icons/drag.svg";
import DiscoveryIcon from "../icons/discovery.svg";

import Locale from "../locales";

import { useAppConfig, useChatStore } from "../store";
import { Theme } from "../store/config";
import { useProviderStore } from "../store/provider";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  NARROW_SIDEBAR_WIDTH,
  Path,
} from "../constant";

import { Link, useNavigate } from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { showConfirm } from "./ui-lib";
import clsx from "clsx";
import { isMcpEnabled } from "../mcp/actions";

/** dynamic 拉取 chat-list chunk 时的占位，避免短暂空白 */
function ChatListChunkPlaceholder() {
  return (
    <div className={styles["chat-list"]}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={styles["chat-item"]}>
          <div className={styles["chat-item-title"]}>
            <span
              className={styles["skeleton-item"]}
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                height: 14,
                width: "4.25em",
                maxWidth: 76,
                borderRadius: 4,
                color: "transparent",
              }}
            >
              {"\u200b"}
            </span>
          </div>
          <div className={styles["chat-item-info"]}>
            <div className={styles["chat-item-count"]}>
              <span
                className={styles["skeleton-item"]}
                style={{
                  display: "inline-block",
                  height: 12,
                  width: i % 2 === 0 ? "6.5em" : "5.5em",
                  minWidth: 72,
                  maxWidth: 132,
                  borderRadius: 4,
                  color: "transparent",
                }}
              >
                {"\u200b"}
              </span>
            </div>
            <div className={styles["chat-item-date"]}>
              <span
                className={styles["skeleton-item"]}
                style={{
                  display: "inline-block",
                  height: 12,
                  width: "11em",
                  minWidth: 128,
                  maxWidth: 188,
                  borderRadius: 4,
                  color: "transparent",
                }}
              >
                {"\u200b"}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const ChatList = dynamic(async () => (await import("./chat-list")).ChatList, {
  loading: () => <ChatListChunkPlaceholder />,
});

export function useHotKey() {
  const chatStore = useChatStore();
  const config = useAppConfig();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) {
        if (e.key === "ArrowUp") {
          chatStore.nextSession(-1);
        } else if (e.key === "ArrowDown") {
          chatStore.nextSession(1);
        } else if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          config.update((c) => {
            c.sidebarWidth =
              c.sidebarWidth < MIN_SIDEBAR_WIDTH
                ? DEFAULT_SIDEBAR_WIDTH
                : NARROW_SIDEBAR_WIDTH;
          });
          config.syncToDB();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

export function useDragSideBar() {
  const limit = (x: number) => Math.min(MAX_SIDEBAR_WIDTH, x);

  const config = useAppConfig();
  const startX = useRef(0);
  const startDragWidth = useRef(config.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
  const lastUpdateTime = useRef(Date.now());

  const toggleSideBar = () => {
    config.update((config) => {
      if (config.sidebarWidth < MIN_SIDEBAR_WIDTH) {
        config.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
      } else {
        config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
      }
    });
    config.syncToDB();
  };

  const onDragStart = (e: MouseEvent) => {
    // Remembers the initial width each time the mouse is pressed
    startX.current = e.clientX;
    startDragWidth.current = config.sidebarWidth;
    const dragStartTime = Date.now();

    const handleDragMove = (e: MouseEvent) => {
      if (Date.now() < lastUpdateTime.current + 20) {
        return;
      }
      lastUpdateTime.current = Date.now();
      const d = e.clientX - startX.current;
      const nextWidth = limit(startDragWidth.current + d);
      config.update((config) => {
        if (nextWidth < MIN_SIDEBAR_WIDTH) {
          config.sidebarWidth = NARROW_SIDEBAR_WIDTH;
        } else {
          config.sidebarWidth = nextWidth;
        }
      });
    };

    const handleDragEnd = () => {
      // In useRef the data is non-responsive, so `config.sidebarWidth` can't get the dynamic sidebarWidth
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);

      // if user click the drag icon, should toggle the sidebar
      const shouldFireClick = Date.now() - dragStartTime < 300;
      if (shouldFireClick) {
        toggleSideBar();
      } else {
        config.syncToDB();
      }
    };

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  };

  const isMobileScreen = useMobileScreen();
  const shouldNarrow =
    !isMobileScreen && config.sidebarWidth < MIN_SIDEBAR_WIDTH;

  // 用 useLayoutEffect 代替 useEffect：在 DOM 提交后、浏览器绘制前同步执行
  // 确保 --sidebar-width 在首帧绘制前已设置，消除侧边栏宽度闪烁
  useLayoutEffect(() => {
    const barWidth = shouldNarrow
      ? NARROW_SIDEBAR_WIDTH
      : limit(config.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH);
    const sideBarWidth = isMobileScreen ? "100vw" : `${barWidth}px`;
    document.documentElement.style.setProperty("--sidebar-width", sideBarWidth);
  }, [config.sidebarWidth, isMobileScreen, shouldNarrow]);

  return {
    onDragStart,
    shouldNarrow,
  };
}

export function SideBarContainer(props: {
  children: React.ReactNode;
  onDragStart: (e: MouseEvent) => void;
  shouldNarrow: boolean;
  className?: string;
}) {
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isIOS() && isMobileScreen,
    [isMobileScreen],
  );
  const { children, className, onDragStart, shouldNarrow } = props;
  return (
    <div
      className={clsx(styles.sidebar, className, {
        [styles["narrow-sidebar"]]: shouldNarrow,
      })}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen && isIOSMobile ? "none" : undefined,
      }}
    >
      {children}
      <div
        className={styles["sidebar-drag"]}
        onPointerDown={(e) => onDragStart(e as any)}
      >
        <DragIcon />
      </div>
    </div>
  );
}

export function SideBarHeader(props: {
  title?: string | React.ReactNode;
  subTitle?: string | React.ReactNode;
  logo?: React.ReactNode;
  children?: React.ReactNode;
  shouldNarrow?: boolean;
}) {
  const { title, subTitle, logo, children, shouldNarrow } = props;
  return (
    <Fragment>
      <div
        className={clsx(styles["sidebar-header"], {
          [styles["sidebar-header-narrow"]]: shouldNarrow,
        })}
        data-tauri-drag-region
      >
        <div className={styles["sidebar-title-container"]}>
          <div className={styles["sidebar-title"]} data-tauri-drag-region>
            {title}
          </div>
          <div className={styles["sidebar-sub-title"]}>{subTitle}</div>
        </div>
        <div className={clsx(styles["sidebar-logo"], "no-dark")}>{logo}</div>
      </div>
      {children}
    </Fragment>
  );
}

export function SideBarBody(props: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}) {
  const { onClick, children } = props;
  return (
    <div className={styles["sidebar-body"]} onClick={onClick}>
      {children}
    </div>
  );
}

export function SideBarTail(props: {
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  const { primaryAction, secondaryAction } = props;

  return (
    <div className={styles["sidebar-tail"]}>
      <div className={styles["sidebar-actions"]}>{primaryAction}</div>
      <div className={styles["sidebar-actions"]}>{secondaryAction}</div>
    </div>
  );
}

export function SideBar(props: { className?: string }) {
  useHotKey();
  const { onDragStart, shouldNarrow } = useDragSideBar();
  const navigate = useNavigate();
  const config = useAppConfig();
  const chatStore = useChatStore();
  const providerStore = useProviderStore();
  // ChatList 在 db 未就绪时会显示骨架；不要等 dbLoaded 再挂载，否则加载阶段侧边栏整块空白。
  const hasEnabledProvider = providerStore.providers.some((p) => p.enabled);
  const [mcpEnabled, setMcpEnabled] = useState(false);

  useEffect(() => {
    // 检查 MCP 是否启用
    const checkMcpStatus = async () => {
      const enabled = await isMcpEnabled();
      setMcpEnabled(enabled);
      console.log("[SideBar] MCP enabled:", enabled);
    };
    checkMcpStatus();
  }, []);

  return (
    <SideBarContainer
      onDragStart={onDragStart}
      shouldNarrow={shouldNarrow}
      {...props}
    >
      <SideBarHeader
        title="NoneChat"
        subTitle="Less is Intelligent."
        logo={<ChatGptIcon />}
        shouldNarrow={shouldNarrow}
      >
        <div className={styles["sidebar-header-bar"]}>
          {hasEnabledProvider && (
            <IconButton
              icon={<MaskIcon />}
              text={shouldNarrow ? undefined : Locale.Mask.Name}
              className={styles["sidebar-bar-button"]}
              onClick={() => {
                if (config.dontShowMaskSplashScreen !== true) {
                  navigate(Path.NewChat, { state: { fromHome: true } });
                } else {
                  navigate(Path.Masks, { state: { fromHome: true } });
                }
              }}
              shadow
            />
          )}
          {mcpEnabled && (
            <IconButton
              icon={<McpIcon />}
              text={shouldNarrow ? undefined : Locale.Mcp.Name}
              className={styles["sidebar-bar-button"]}
              onClick={() => {
                navigate(Path.McpMarket, { state: { fromHome: true } });
              }}
              shadow
            />
          )}
          <IconButton
            icon={<DiscoveryIcon />}
            text={shouldNarrow ? undefined : Locale.Discovery.Name}
            className={styles["sidebar-bar-button"]}
            onClick={() =>
              navigate(Path.SearchChat, { state: { fromHome: true } })
            }
            shadow
          />
        </div>
      </SideBarHeader>
      <SideBarBody
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            navigate(Path.Home);
          }
        }}
      >
        {hasEnabledProvider && <ChatList narrow={shouldNarrow} />}
      </SideBarBody>
      <SideBarTail
        primaryAction={
          <>
            <div className={clsx(styles["sidebar-action"], styles.mobile)}>
              <IconButton
                icon={<DeleteIcon />}
                onClick={async () => {
                  if (await showConfirm(Locale.Home.DeleteChat)) {
                    chatStore.deleteSession(chatStore.currentSessionIndex);
                  }
                }}
              />
            </div>
            <div className={styles["sidebar-action"]}>
              <IconButton
                aria="切换主题"
                icon={
                  config.theme === Theme.Auto ? (
                    <AutoIcon />
                  ) : config.theme === Theme.Light ? (
                    <LightIcon />
                  ) : (
                    <DarkIcon />
                  )
                }
                shadow
                onClick={() =>
                  config.update((c) => {
                    const themes = [Theme.Auto, Theme.Light, Theme.Dark];
                    const idx = themes.indexOf(c.theme);
                    c.theme = themes[(idx + 1) % themes.length];
                  })
                }
              />
            </div>
            <div className={styles["sidebar-action"]}>
              <Link to={Path.Settings}>
                <IconButton
                  aria={Locale.Settings.Title}
                  icon={<SettingsIcon />}
                  shadow
                />
              </Link>
            </div>
          </>
        }
        secondaryAction={
          hasEnabledProvider && (
            <IconButton
              icon={<AddIcon />}
              text={shouldNarrow ? undefined : Locale.Home.NewChat}
              onClick={() => {
                if (config.dontShowMaskSplashScreen) {
                  chatStore.newSession();
                  navigate(Path.Chat);
                } else {
                  navigate(Path.NewChat);
                }
              }}
              shadow
            />
          )
        }
      />
    </SideBarContainer>
  );
}
