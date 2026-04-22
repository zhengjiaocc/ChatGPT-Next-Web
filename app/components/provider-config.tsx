import { useState } from "react";
import {
  useProviderStore,
  PROVIDER_PRESETS,
  ProviderInstance,
} from "../store/provider";
import { ServiceProvider } from "../constant";
import {
  List,
  ListItem,
  Modal,
  PasswordInput,
  showConfirm,
  showToast,
} from "./ui-lib";
import { IconButton } from "./button";
import { Avatar } from "./emoji";
import { PROVIDER_ICON_MODEL } from "../utils/provider-icons";
import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/delete.svg";
import EditIcon from "../icons/edit.svg";
import ResetIcon from "../icons/reload.svg";
import LeftIcon from "../icons/left.svg";
import styles from "./provider-config.module.scss";

async function discoverModels(
  type: ServiceProvider,
  apiKey: string,
  baseUrl: string,
): Promise<string[]> {
  const res = await fetch("/api/provider-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, apiKey, baseUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch models");
  return data.models as string[];
}

function ProviderDialog(props: {
  instance?: ProviderInstance;
  type?: ServiceProvider;
  onClose: () => void;
}) {
  const store = useProviderStore();
  const isEdit = !!props.instance?.id;
  const [label, setLabel] = useState(props.instance?.label ?? "");
  const [apiKey, setApiKey] = useState(props.instance?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(
    props.instance?.baseUrl ??
      PROVIDER_PRESETS[props.type ?? ""]?.baseUrl ??
      "",
  );
  const [manualModels, setManualModels] = useState<string[]>(
    props.instance?.models ?? [],
  );
  const [supportsDiscovery, setSupportsDiscovery] = useState(
    props.instance?.supportsDiscovery ?? true,
  );
  const [modelInput, setModelInput] = useState("");
  const [discovering, setDiscovering] = useState(false);

  function addModel() {
    const m = modelInput.trim();
    if (m && !manualModels.includes(m)) {
      setManualModels([...manualModels, m]);
    }
    setModelInput("");
  }

  async function save() {
    if (!apiKey.trim()) {
      showToast("请输入 API Key");
      return;
    }
    setDiscovering(true);
    try {
      const type = props.instance?.type ?? props.type!;
      let models: string[];
      if (supportsDiscovery) {
        try {
          models = await discoverModels(type, apiKey, baseUrl);
          showToast(`发现 ${models.length} 个模型`);
        } catch {
          if (manualModels.length > 0) {
            showToast("自动发现失败，使用已有模型保存");
            models = manualModels;
          } else {
            showToast("自动发现失败，请手动添加模型或关闭模型发现");
            setDiscovering(false);
            return;
          }
        }
      } else {
        if (manualModels.length === 0) {
          showToast("请至少添加一个模型");
          setDiscovering(false);
          return;
        }
        models = manualModels;
      }
      if (isEdit) {
        store.updateProvider(props.instance!.id, {
          label,
          apiKey,
          baseUrl,
          models,
          supportsDiscovery,
        });
      } else {
        const id = store.addProvider(type, label, apiKey, baseUrl);
        store.setModels(id, models);
        store.updateProvider(id, { supportsDiscovery });
      }
      props.onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败");
    }
    setDiscovering(false);
  }

  const type = props.instance?.type ?? props.type!;
  const title = isEdit
    ? `编辑 — ${PROVIDER_PRESETS[type]?.label ?? type}`
    : `新建 — ${PROVIDER_PRESETS[type]?.label ?? type}`;

  return (
    <div className="modal-mask">
      <Modal
        title={title}
        onClose={props.onClose}
        actions={[
          <IconButton
            key="save"
            text={discovering ? "保存中..." : "保存"}
            type="primary"
            onClick={save}
            disabled={discovering}
          />,
        ]}
      >
        <List>
          <ListItem title="描述">
            <input
              type="text"
              value={label}
              placeholder="可选，如：个人账号"
              onChange={(e) => setLabel(e.currentTarget.value)}
            />
          </ListItem>
          <ListItem title="API Key">
            <PasswordInput
              value={apiKey}
              placeholder="输入 API Key"
              onChange={(e) => setApiKey(e.currentTarget.value)}
            />
          </ListItem>
          <ListItem title="Base URL">
            <input
              type="text"
              value={baseUrl}
              placeholder="留空使用默认"
              onChange={(e) => setBaseUrl(e.currentTarget.value)}
            />
          </ListItem>
          <ListItem title="支持模型发现" subTitle="自动获取可用模型列表">
            <input
              type="checkbox"
              aria-label="支持模型发现"
              checked={supportsDiscovery}
              onChange={(e) => setSupportsDiscovery(e.currentTarget.checked)}
            />
          </ListItem>
          {!supportsDiscovery && (
            <ListItem title="自定义模型" vertical>
              <div className={styles["manual-models-input"]}>
                <input
                  type="text"
                  value={modelInput}
                  placeholder="输入模型名，如 claude-opus-4-6"
                  onChange={(e) => setModelInput(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && addModel()}
                />
                <IconButton icon={<AddIcon />} onClick={addModel} />
              </div>
            </ListItem>
          )}
          {!supportsDiscovery && manualModels.length > 0 && (
            <ListItem>
              <div className={styles["model-tags"]}>
                {manualModels.map((m) => (
                  <span key={m} className={styles["model-tag"]}>
                    {m}
                    <span
                      className={styles["model-tag-del"]}
                      onClick={() =>
                        setManualModels(manualModels.filter((x) => x !== m))
                      }
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            </ListItem>
          )}
        </List>
      </Modal>
    </div>
  );
}

export function ProviderConfig() {
  const store = useProviderStore();
  const providers = store.providers;
  const presetEntries = Object.entries(PROVIDER_PRESETS);
  const [activeTab, setActiveTab] = useState<ServiceProvider>(
    presetEntries[0][0] as ServiceProvider,
  );
  const [dialog, setDialog] = useState<{
    instance?: ProviderInstance;
    type?: ServiceProvider;
  } | null>(null);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const tabProviders = providers.filter((p) => p.type === activeTab);

  async function rediscover(p: ProviderInstance) {
    setDiscovering(p.id);
    try {
      const models = await discoverModels(p.type, p.apiKey, p.baseUrl);
      store.setModels(p.id, models);
      showToast(`发现 ${models.length} 个模型`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "发现模型失败");
    }
    setDiscovering(null);
  }

  async function remove(p: ProviderInstance) {
    const ok = await showConfirm(`确认删除「${p.label || p.type}」？`);
    if (ok) store.deleteProvider(p.id);
  }

  return (
    <div>
      {/* Tab bar + Add button */}
      <div className={styles["tab-bar"]}>
        {presetEntries.map(([type, preset]) => {
          const count = providers.filter((p) => p.type === type).length;
          const isActive = activeTab === type;
          return (
            <IconButton
              key={type}
              icon={
                <span className={styles["tab-icon"]}>
                  <Avatar
                    model={PROVIDER_ICON_MODEL[type] ?? type}
                    iconType="provider"
                  />
                </span>
              }
              text={`${preset.label}${count > 0 ? ` (${count})` : ""}`}
              bordered
              className={isActive ? styles["tab-active"] : undefined}
              onClick={() => setActiveTab(type as ServiceProvider)}
            />
          );
        })}
        <div className={styles["spacer"]} />
        <IconButton
          icon={<AddIcon />}
          text="添加"
          bordered
          onClick={() => setDialog({ type: activeTab })}
        />
      </div>

      {/* Content */}
      <div className={styles["content"]}>
        {tabProviders.length === 0 ? (
          <div className={styles["empty"]}>
            暂无实例，点击&quot;添加&quot;创建
          </div>
        ) : (
          <List>
            {tabProviders.map((p) => (
              <div key={p.id}>
                <div
                  className={`${styles["provider-row"]}${
                    p.models.length > 0 ? ` ${styles["clickable"]}` : ""
                  }`}
                  onClick={() =>
                    p.models.length > 0 &&
                    setExpanded(expanded === p.id ? null : p.id)
                  }
                >
                  <div
                    className={styles["expand-icon"]}
                    data-hidden={p.models.length === 0 ? "true" : undefined}
                  >
                    <LeftIcon
                      className={
                        expanded === p.id
                          ? styles["icon-expanded"]
                          : styles["icon-collapsed"]
                      }
                    />
                  </div>
                  <div className={styles["provider-row-content"]}>
                    <ListItem
                      title={
                        p.label || PROVIDER_PRESETS[p.type]?.label || p.type
                      }
                      subTitle={
                        p.models.length > 0
                          ? `${p.models.length} 个模型`
                          : "暂无模型"
                      }
                    >
                      <div
                        className={styles["action-row"]}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <label className={styles["toggle"]}>
                          <input
                            type="checkbox"
                            aria-label="启用"
                            checked={p.enabled}
                            onChange={(e) =>
                              store.updateProvider(p.id, {
                                enabled: e.currentTarget.checked,
                              })
                            }
                          />
                          <span />
                        </label>
                        {p.supportsDiscovery && (
                          <IconButton
                            icon={<ResetIcon />}
                            title="重新发现"
                            disabled={discovering === p.id}
                            onClick={() => rediscover(p)}
                          />
                        )}
                        <IconButton
                          icon={<EditIcon />}
                          title="编辑"
                          onClick={() => setDialog({ instance: p })}
                        />
                        <IconButton
                          icon={<DeleteIcon />}
                          title="删除"
                          onClick={() => remove(p)}
                        />
                      </div>
                    </ListItem>
                  </div>
                </div>
                {expanded === p.id && (
                  <div className={styles["model-tags"]}>
                    {p.models.map((m) => (
                      <span key={m} className={styles["model-tag"]}>
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </List>
        )}
      </div>

      {dialog && (
        <ProviderDialog
          instance={dialog.instance}
          type={dialog.type}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
