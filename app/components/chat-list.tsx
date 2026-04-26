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
import { useRef, useEffect, useLayoutEffect, useState } from "react";
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
  const listRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  // Use layout effect so first paint already uses real height,
  // avoiding skeleton count jump that can cause scrollbar flash.
  useLayoutEffect(() => {
    const el = listRef.current?.parentElement;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ITEM_HEIGHT = props.narrow ? 61 : 71;
  const skeletonCount = Math.max(3, Math.floor(containerHeight / ITEM_HEIGHT));

  if (!chatStore.dbLoaded) {
    return (
      <div className={styles["chat-list"]} ref={listRef}>
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
            // 普通模式：与 ChatItem 一致 — 标题 / 条数+时间（底行两端对齐）
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
