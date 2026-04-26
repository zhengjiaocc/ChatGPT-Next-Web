import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUser } from "../../../lib/auth";
import sql from "../../../lib/db";
import { consumeRateLimit, getRequestIp } from "../../../lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ip = getRequestIp(req);
  const limit = await consumeRateLimit({
    key: `change-password:${user.id}:${ip}`,
    limit: 6,
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

  const { oldPassword, newPassword } = await req.json();
  if (!oldPassword || !newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (rows.length === 0)
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const valid = await bcrypt.compare(oldPassword, rows[0].password_hash);
  if (!valid)
    return NextResponse.json({ error: "原密码错误" }, { status: 400 });

  const hash = await bcrypt.hash(newPassword, 10);
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
