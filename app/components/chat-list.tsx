import DeleteIcon from "../icons/delete.svg";

import styles from "./home.module.scss";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

import { useChatStore } from "../store";

import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { MaskAvatar } from "./mask";
import { Mask } from "../store/mask";
import { useRef, useEffect } from "react";
import { showConfirm } from "./ui-lib";
import { useMobileScreen } from "../utils";
import clsx from "clsx";

export function ChatItem(props: {
  onClick?: () => void;
  onDelete?: () => void;
  title: string;
  count: number;
  time: string;
  selected: boolean;
  id: string;
  index: number;
  narrow?: boolean;
  mask: Mask;
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (props.selected && draggableRef.current) {
      draggableRef.current?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [props.selected]);

  const { pathname: currentPath } = useLocation();
  return (
    <Draggable draggableId={`${props.id}`} index={props.index}>
      {(provided) => (
        <div
          className={clsx(styles["chat-item"], {
            [styles["chat-item-selected"]]:
              props.selected &&
              (currentPath === Path.Chat || currentPath === Path.Home),
          })}
          onClick={props.onClick}
          ref={(ele) => {
            draggableRef.current = ele;
            provided.innerRef(ele);
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          title={`${props.title}\n${Locale.ChatItem.ChatItemCount(
            props.count,
          )}`}
        >
          {props.narrow ? (
            <div className={styles["chat-item-narrow"]}>
              <div className={clsx(styles["chat-item-avatar"], "no-dark")}>
                <MaskAvatar
                  avatar={props.mask.avatar}
                  model={props.mask.modelConfig.model}
                />
              </div>
              <div className={styles["chat-item-narrow-count"]}>
                {props.count}
              </div>
            </div>
          ) : (
            <>
              <div className={styles["chat-item-title"]}>{props.title}</div>
              <div className={styles["chat-item-info"]}>
                <div className={styles["chat-item-count"]}>
                  {Locale.ChatItem.ChatItemCount(props.count)}
                </div>
                <div className={styles["chat-item-date"]}>{props.time}</div>
              </div>
            </>
          )}

          <div
            className={styles["chat-item-delete"]}
            onClickCapture={(e) => {
              props.onDelete?.();
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DeleteIcon />
          </div>
        </div>
      )}
    </Draggable>
  );
}

export function ChatList(props: { narrow?: boolean }) {
  const [sessions, selectedIndex, selectSession, moveSession] = useChatStore(
    (state) => [
      state.sessions,
      state.currentSessionIndex,
      state.selectSession,
      state.moveSession,
    ],
  );
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();

  // sessions 由 IndexedDB 异步加载，首次渲染时为初始默认值，无法用作骨架数量
  // narrow 模式下每条 item 高度 ≈ 50px + 11px margin = 61px
  // 普通模式下 ≈ 71px（含 padding/border）
  const ITEM_HEIGHT = props.narrow ? 61 : 71;
  const sidebarBodyHeight =
    typeof window !== "undefined"
      ? window.innerHeight - (isMobileScreen ? 200 : 250)
      : 400;
  const skeletonCount = Math.max(
    3,
    Math.floor(sidebarBodyHeight / ITEM_HEIGHT),
  );

  if (!chatStore.dbLoaded) {
    return (
      <div className={styles["chat-list"]}>
        {Array.from({ length: skeletonCount }).map((_, i) =>
          props.narrow ? (
            // 收起模式：完美复刻原组件的 chat-item-narrow 和 chat-item-avatar
            <div key={i} className={styles["chat-item"]}>
              <div className={styles["chat-item-narrow"]}>
                <div
                  className={`${styles["chat-item-avatar"]} ${styles["skeleton-item"]}`}
                  style={{ color: "transparent", backgroundSize: "cover" }}
                >
                  {"\u200b"}
                </div>
              </div>
            </div>
          ) : (
            // 普通模式：标题行 + 信息行
            <div key={i} className={styles["chat-item"]}>
              <div
                className={`${styles["chat-item-title"]} ${styles["skeleton-item"]}`}
                style={{
                  color: "transparent",
                  borderRadius: "4px",
                  width: i % 2 === 0 ? "75%" : "55%",
                }}
              >
                {"\u200b"}
              </div>
              <div
                className={`${styles["chat-item-info"]} ${styles["skeleton-item"]}`}
                style={{
                  color: "transparent",
                  borderRadius: "4px",
                  width: "45%",
                }}
              >
                {"\u200b"}
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;
    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    moveSession(source.index, destination.index);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="chat-list">
        {(provided) => (
          <div
            className={styles["chat-list"]}
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {sessions.map((item, i) => (
              <ChatItem
                title={item.topic}
                time={new Date(item.lastUpdate).toLocaleString()}
                count={
                  item.messagesLoaded
                    ? item.messages.length
                    : item.messageCount ?? 0
                }
                key={item.id}
                id={item.id}
                index={i}
                selected={i === selectedIndex}
                onClick={() => {
                  navigate(Path.Chat);
                  selectSession(i);
                }}
                onDelete={async () => {
                  if (await showConfirm(Locale.Home.DeleteChat)) {
                    chatStore.deleteSession(i);
                  }
                }}
                narrow={props.narrow}
                mask={item.mask}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
