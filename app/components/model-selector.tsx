import { useState } from "react";
import { Avatar } from "./emoji";
import { PROVIDER_ICON_MODEL } from "../utils/provider-icons";
import styles from "./model-selector.module.scss";

interface ProviderGroup {
  provider: string;
  models: Array<{ name: string; displayName?: string }>;
}

export function ModelSelector(props: {
  groups: ProviderGroup[];
  currentValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const [activeProvider, setActiveProvider] = useState(
    props.groups.find((g) =>
      g.models.some((m) => `${m.name}@${g.provider}` === props.currentValue),
    )?.provider ?? props.groups[0]?.provider,
  );
  const [splitView, setSplitView] = useState(true);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    new Set(),
  );

  const activeGroup = props.groups.find((g) => g.provider === activeProvider);

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
                  onClick={() => setActiveProvider(g.provider)}
                >
                  <Avatar
                    model={PROVIDER_ICON_MODEL[g.provider] ?? g.provider}
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
              {activeGroup?.models.map((m) => {
                const value = `${m.name}@${activeGroup.provider}`;
                const selected = value === props.currentValue;
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
                    <span className={styles["list-arrow"]}>
                      {expanded ? "▼" : "▶"}
                    </span>
                    <Avatar
                      model={PROVIDER_ICON_MODEL[g.provider] ?? g.provider}
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
                      const value = `${m.name}@${g.provider}`;
                      const selected = value === props.currentValue;
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
