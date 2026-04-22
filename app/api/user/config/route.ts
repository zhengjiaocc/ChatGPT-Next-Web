import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../lib/auth";
import sql from "../../../lib/db";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows =
    await sql`SELECT config FROM app_configs WHERE user_id = ${user.id}`;
  return NextResponse.json(rows[0]?.config ?? {});
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await req.json();
  await sql`
    INSERT INTO app_configs (user_id, config) VALUES (${
      user.id
    }, ${JSON.stringify(config)})
    ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}
