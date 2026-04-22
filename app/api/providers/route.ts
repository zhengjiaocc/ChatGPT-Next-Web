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

  const { id, type, label, api_key, base_url, models, enabled } =
    await req.json();
  const encryptedKey = await encrypt(api_key ?? "");
  await sql`
    INSERT INTO provider_configs (id, user_id, type, label, api_key, base_url, models, enabled)
    VALUES (${id}, ${
      user.id
    }, ${type}, ${label}, ${encryptedKey}, ${base_url}, ${JSON.stringify(
      models,
    )}, ${enabled})
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      api_key = EXCLUDED.api_key,
      base_url = EXCLUDED.base_url,
      models = EXCLUDED.models,
      enabled = EXCLUDED.enabled,
      updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await sql`DELETE FROM provider_configs WHERE id = ${id} AND user_id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
