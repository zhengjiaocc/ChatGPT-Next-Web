import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import sql from "../../../lib/db";
import { verifyTurnstile } from "../../../lib/turnstile";
import { consumeRateLimit, getRequestIp } from "../../../lib/rate-limit";

const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);

export async function POST(req: NextRequest) {
  const { username, password, turnstileToken } = await req.json();
  const normalizedUsername =
    typeof username === "string" ? username.trim().toLowerCase() : "";
  const ip = getRequestIp(req);
  const limit = await consumeRateLimit({
    key: `login:${ip}:${normalizedUsername || "unknown"}`,
    limit: 10,
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

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 64 ||
    password.length > 128
  ) {
    return NextResponse.json({ error: "输入无效" }, { status: 400 });
  }

  if (!(await verifyTurnstile(turnstileToken ?? ""))) {
    return NextResponse.json({ error: "人机验证失败" }, { status: 400 });
  }

  const rows =
    await sql`SELECT id, password_hash FROM users WHERE username = ${username}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  const token = await new SignJWT({ sub: rows[0].id, username })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(SECRET);

  const res = NextResponse.json({ ok: true, id: rows[0].id, username });
  res.cookies.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
