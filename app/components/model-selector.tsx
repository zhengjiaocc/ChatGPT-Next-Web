import { useState } from "react";
import { Avatar } from "./emoji";
import { PROVIDER_ICON_MODEL } from "../utils/provider-icons";
import LeftIcon from "../icons/left.svg";
import styles from "./model-selector.module.scss";

interface ProviderGroup {
  provider: string;
  models: Array<{ name: string; displayName?: string; providerId?: string }>;
}

export function ModelSelector(props: {
  groups: ProviderGroup[];
  currentValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const [activeProvider, setActiveProvider] = useState(
    props.groups.find((g) =>
      g.models.some((m) => {
        const v = m.providerId
          ? `${m.name}@${g.provider}|${m.providerId}`
          : `${m.name}@${g.provider}`;
        return (
          v === props.currentValue ||
          `${m.name}@${g.provider}` === props.currentValue
        );
      }),
    )?.provider ?? props.groups[0]?.provider,
  );
  const [splitView, setSplitView] = useState(true);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    new Set(),
  );
  const [search, setSearch] = useState("");

  const activeGroup = props.groups.find((g) => g.provider === activeProvider);
  const filteredModels = search
    ? activeGroup?.models.filter((m) =>
        (m.displayName ?? m.name).toLowerCase().includes(search.toLowerCase()),
      )
    : activeGroup?.models;

  function toggleProvider(provider: string) {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      next.has(provider) ? next.delete(provider) : next.add(provider);
      return next;
    });
  }

  return (
    <div className={styles["mask"]} onClick={props.onClose}>
      <div
        className={`${styles["container"]} ${
          !splitView ? styles["list-mode"] : ""
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles["header"]}>
          <span className={styles["header-title"]}>选择模型</span>
          <div className={styles["header-search"]}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles["search-icon"]}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="搜索模型..."
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
          <button
            className={styles["layout-toggle"]}
            onClick={() => setSplitView(!splitView)}
            title={splitView ? "切换为列表视图" : "切换为分栏视图"}
          >
            {splitView ? "☰" : "⊞"}
          </button>
        </div>

        {splitView ? (
          <div className={styles["split-body"]}>
            <div className={styles["left"]}>
              <div className={styles["panel-title"]}>提供商</div>
              {props.groups.map((g) => (
                <div
                  key={g.provider}
                  className={`${styles["provider-item"]} ${
                    g.provider === activeProvider ? styles["active"] : ""
                  }`}
                  onClick={() => {
                    setActiveProvider(g.provider);
                    setSearch("");
                  }}
                >
                  <Avatar
                    model={PROVIDER_ICON_MODEL[g.provider] ?? g.provider}
                    iconType="provider"
                  />
                  <div className={styles["provider-info"]}>
                    <div className={styles["provider-name"]}>{g.provider}</div>
                    <div className={styles["provider-count"]}>
                      {g.models.length} 个模型
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles["right"]}>
              <div className={styles["panel-title"]}>
                {activeProvider ?? "模型"}
              </div>
              {filteredModels?.map((m) => {
                const value = m.providerId
                  ? `${m.name}@${activeGroup?.provider}|${m.providerId}`
                  : `${m.name}@${activeGroup?.provider}`;
                const selected =
                  value === props.currentValue ||
                  `${m.name}@${activeGroup?.provider}` === props.currentValue;
                return (
                  <div
                    key={value}
                    className={`${styles["model-item"]} ${
                      selected ? styles["selected"] : ""
                    }`}
                    onClick={() => {
                      props.onSelect(value);
                      props.onClose();
                    }}
                  >
                    <span>{m.displayName ?? m.name}</span>
                    {selected && <span className={styles["dot"]} />}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={styles["list-body"]}>
            {props.groups.map((g) => {
              const expanded = expandedProviders.has(g.provider);
              return (
                <div key={g.provider}>
                  <div
                    className={styles["list-group-header"]}
                    onClick={() => toggleProvider(g.provider)}
                  >
                    <LeftIcon
                      className={
                        expanded
                          ? styles["icon-expanded"]
                          : styles["icon-collapsed"]
                      }
                    />
                    <Avatar
                      model={PROVIDER_ICON_MODEL[g.provider] ?? g.provider}
                      iconType="provider"
                    />
                    <span className={styles["provider-name"]}>
                      {g.provider}
                    </span>
                    <span className={styles["provider-count"]}>
                      {g.models.length} 个模型
                    </span>
                  </div>
                  {expanded &&
                    g.models.map((m) => {
                      const value = m.providerId
                        ? `${m.name}@${g.provider}|${m.providerId}`
                        : `${m.name}@${g.provider}`;
                      const selected =
                        value === props.currentValue ||
                        `${m.name}@${g.provider}` === props.currentValue;
                      return (
                        <div
                          key={value}
                          className={`${styles["list-model-item"]} ${
                            selected ? styles["selected"] : ""
                          }`}
                          onClick={() => {
                            props.onSelect(value);
                            props.onClose();
                          }}
                        >
                          <span>{m.displayName ?? m.name}</span>
                          {selected && <span className={styles["dot"]} />}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
