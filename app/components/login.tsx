import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Turnstile } from "@marsidev/react-turnstile";
import { Path } from "../constant";
import { IconButton } from "./button";
import BotIcon from "../icons/bot.svg";
import EyeIcon from "../icons/eye.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import LoadingIcon from "../icons/three-dots.svg";
import { useUserStore } from "../store/user";
import { useChatStore } from "../store";
import { useProviderStore } from "../store/provider";
import { useAppConfig } from "../store/config";
import { getClientApi } from "../client/api";
import styles from "./login.module.scss";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export function LoginPage() {
  const navigate = useNavigate();
  const userStore = useUserStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  const submit = async () => {
    if (!username.trim() || !password.trim()) {
      setError("用户名和密码不能为空");
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("请完成人机验证");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch(
      mode === "login" ? "/api/auth/login" : "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, turnstileToken }),
      },
    );
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "操作失败");
      return;
    }
    if (mode === "register") {
      setMode("login");
      setError("注册成功，请登录");
      return;
    }
    userStore.login(data.id, data.username);
    // 登录后初始化：加载 DB 数据
    await Promise.all([
      useChatStore.getState().loadFromDB(),
      useProviderStore.getState().loadFromDB(),
      useAppConfig.getState().loadFromDB(),
    ]);
    // 自动发现所有 enabled provider 的模型
    const providers = useProviderStore.getState().providers;
    providers
      .filter((p) => p.enabled && p.supportsDiscovery)
      .forEach((p) => {
        fetch("/api/provider-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: p.type,
            apiKey: p.apiKey,
            baseUrl: p.baseUrl,
          }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.models?.length)
              useProviderStore.getState().setModels(p.id, d.models);
          })
          .catch(() => {});
      });
    const config = useAppConfig.getState();
    // Fill providerId for global modelConfig based on providerName
    const { model, providerName } = config.modelConfig;
    const matchedProvider =
      providers.find(
        (p) =>
          p.enabled &&
          p.type.toLowerCase() === (providerName ?? "").toLowerCase() &&
          p.models.includes(model),
      ) ??
      providers.find(
        (p) =>
          p.enabled &&
          p.type.toLowerCase() === (providerName ?? "").toLowerCase(),
      ) ??
      providers.find((p) => p.enabled);
    if (matchedProvider && !config.modelConfig.providerId) {
      config.update((c) => {
        c.modelConfig.providerId = matchedProvider.id;
        if (matchedProvider.type !== providerName)
          c.modelConfig.providerName = matchedProvider.type as any;
        if (
          matchedProvider.models.length > 0 &&
          !matchedProvider.models.includes(model)
        )
          c.modelConfig.model = matchedProvider.models[0] as any;
      });
    }
    const api = getClientApi(config.modelConfig.providerName);
    api.llm.models().then((models) => config.mergeModels(models));
    navigate(Path.Chat);
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div
          className="no-dark"
          style={{
            alignSelf: "center",
            transform: "scale(1.2)",
            marginBottom: 16,
          }}
        >
          <BotIcon />
        </div>
        <div className={styles.title}>{mode === "login" ? "登录" : "注册"}</div>

        <input
          className={styles.input}
          type="text"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <div className={styles.pwdRow}>
          <input
            className={styles.pwdInput}
            type={showPwd ? "text" : "password"}
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <span className={styles.eyeBtn} onClick={() => setShowPwd(!showPwd)}>
            {showPwd ? <EyeIcon /> : <EyeOffIcon />}
          </span>
        </div>

        {error && (
          <div
            className={
              error === "注册成功，请登录" ? styles.success : styles.error
            }
          >
            {error}
          </div>
        )}

        {TURNSTILE_SITE_KEY && (
          <Turnstile
            siteKey={TURNSTILE_SITE_KEY}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken("")}
            style={{ marginBottom: 8, width: "100%" }}
          />
        )}

        <div className={styles.btn}>
          <IconButton
            icon={loading ? <LoadingIcon /> : undefined}
            text={loading ? "请稍候..." : mode === "login" ? "登录" : "注册"}
            type="primary"
            disabled={loading}
            onClick={submit}
          />
        </div>

        <span
          className={styles.switchMode}
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
        </span>
      </div>
    </div>
  );
}
