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
