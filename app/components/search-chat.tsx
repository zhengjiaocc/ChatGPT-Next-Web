import { useState, useCallback } from "react";
import { ErrorBoundary } from "./error";
import styles from "./mask.module.scss";
import { useNavigate } from "react-router-dom";
import { IconButton } from "./button";
import CloseIcon from "../icons/close.svg";
import EyeIcon from "../icons/eye.svg";
import Locale from "../locales";
import { Path } from "../constant";
import { useChatStore } from "../store";

type Item = {
  id: number;
  name: string;
  content: string;
};

export function SearchChatPage() {
  const navigate = useNavigate();
  const chatStore = useChatStore();
  const sessions = chatStore.sessions;
  const selectSession = chatStore.selectSession;
  const [searchResults, setSearchResults] = useState<Item[]>([]);

  const doSearch = useCallback(
    (text: string) => {
      if (!text) {
        setSearchResults([]);
        return;
      }
      const lower = text.toLowerCase();
      const results: Item[] = [];
      sessions.forEach((session, index) => {
        if (session.messagesLoaded === false) return;
        const matches: string[] = [];
        session.messages.forEach((message) => {
          const content =
            typeof message.content === "string" ? message.content : "";
          if (!content) return;
          const lc = content.toLowerCase();
          let pos = lc.indexOf(lower);
          while (pos !== -1) {
            const start = Math.max(0, pos - 35);
            const end = Math.min(content.length, pos + lower.length + 35);
            matches.push(content.substring(start, end));
            pos = lc.indexOf(lower, pos + lower.length);
          }
        });
        if (matches.length > 0) {
          results.push({
            id: index,
            name: session.topic,
            content: matches.join("... "),
          });
        }
      });
      results.sort((a, b) => b.content.length - a.content.length);
      setSearchResults(results);
    },
    [sessions],
  );

  return (
    <ErrorBoundary>
      <div className={styles["mask-page"]}>
        <div className="window-header">
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.SearchChat.Page.Title}
            </div>
            <div className="window-header-sub-title">
              {Locale.SearchChat.Page.SubTitle(searchResults.length)}
            </div>
          </div>
          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<CloseIcon />}
                bordered
                onClick={() => navigate(-1)}
              />
            </div>
          </div>
        </div>

        <div className={styles["mask-page-body"]}>
          <div className={styles["mask-filter"]}>
            <input
              type="text"
              className={styles["search-bar"]}
              placeholder={Locale.SearchChat.Page.Search}
              autoFocus
              onChange={(e) => doSearch(e.currentTarget.value)}
            />
          </div>
          <div>
            {searchResults.map((item) => (
              <div
                className={styles["mask-item"]}
                key={item.id}
                onClick={() => {
                  navigate(Path.Chat);
                  selectSession(item.id);
                }}
                style={{ cursor: "pointer" }}
              >
                <div className={styles["mask-header"]}>
                  <div className={styles["mask-title"]}>
                    <div className={styles["mask-name"]}>{item.name}</div>
                    {item.content.slice(0, 70)}
                  </div>
                </div>
                <div className={styles["mask-actions"]}>
                  <IconButton
                    icon={<EyeIcon />}
                    text={Locale.SearchChat.Item.View}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
