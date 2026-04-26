import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../lib/auth";
import sql from "../../lib/db";
import { encrypt, decrypt } from "../../lib/crypto";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const providers = await sql`
    SELECT * FROM provider_configs WHERE user_id = ${user.id}
  `;
  const decrypted = await Promise.all(
    providers.map(async (p: any) => ({
      ...p,
      api_key: await decrypt(p.api_key ?? ""),
    })),
  );
  return NextResponse.json(decrypted);
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id =
    typeof body?.id === "string" && body.id.trim()
      ? body.id.trim()
      : crypto.randomUUID();
  const type = typeof body?.type === "string" ? body.type.trim() : "";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const apiKey = typeof body?.api_key === "string" ? body.api_key : "";
  const baseUrl = typeof body?.base_url === "string" ? body.base_url : "";
  const models = Array.isArray(body?.models) ? body.models : [];
  const enabled = body?.enabled !== false;

  if (!type) {
    return NextResponse.json(
      { error: "Invalid provider type" },
      { status: 400 },
    );
  }

  const encryptedKey = await encrypt(apiKey);
  const result = await sql`
    INSERT INTO provider_configs (id, user_id, type, label, api_key, base_url, models, enabled)
    VALUES (${id}, ${
      user.id
    }, ${type}, ${label}, ${encryptedKey}, ${baseUrl}, ${JSON.stringify(
      models,
    )}, ${enabled})
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      api_key = EXCLUDED.api_key,
      base_url = EXCLUDED.base_url,
      models = EXCLUDED.models,
      enabled = EXCLUDED.enabled,
      updated_at = NOW()
    WHERE provider_configs.user_id = ${user.id}
    RETURNING id
  `;
  if (!result.length) {
    return NextResponse.json(
      { error: "Forbidden: provider does not belong to current user" },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, id: result[0].id });
}

export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await sql`DELETE FROM provider_configs WHERE id = ${id} AND user_id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
