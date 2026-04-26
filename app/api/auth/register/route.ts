import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import sql from "../../../lib/db";
import { verifyTurnstile } from "../../../lib/turnstile";
import { consumeRateLimit, getRequestIp } from "../../../lib/rate-limit";

export async function POST(req: NextRequest) {
  const { username, password, turnstileToken } = await req.json();
  const normalizedUsername =
    typeof username === "string" ? username.trim().toLowerCase() : "";
  const ip = getRequestIp(req);
  const limit = await consumeRateLimit({
    key: `register:${ip}:${normalizedUsername || "unknown"}`,
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      },
    );
  }

  if (!(await verifyTurnstile(turnstileToken ?? ""))) {
    return NextResponse.json({ error: "人机验证失败" }, { status: 400 });
  }

  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json(
      { error: "用户名和密码不能为空" },
      { status: 400 },
    );
  }

  if (
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  ) {
    return NextResponse.json(
      { error: "密码需至少8位，包含大写字母、数字和特殊字符" },
      { status: 400 },
    );
  }

  const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
  if (existing.length > 0) {
    return NextResponse.json({ error: "用户名已存在" }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await sql`
    INSERT INTO users (username, password_hash) VALUES (${username}, ${hash})
    RETURNING id, username
  `;

  return NextResponse.json({ user: result[0] });
}
