import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../../lib/auth";
import sql from "../../../../lib/db";

export const runtime = "edge";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, model, mask, updatedAt } = await req.json();
  const updatedAtMs = Number.isFinite(Number(updatedAt))
    ? Math.max(0, Math.floor(Number(updatedAt)))
    : 0;

  const rows = await sql`
    SELECT id FROM chat_sessions WHERE id = ${params.id} AND user_id = ${user.id} LIMIT 1
  `;
  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await sql`
    UPDATE chat_sessions SET
      title = COALESCE(${title}, title),
      model = COALESCE(${model}, model),
      mask = COALESCE(${JSON.stringify(mask ?? null)}::jsonb, mask),
      updated_at = NOW()
    WHERE
      id = ${params.id}
      AND user_id = ${user.id}
      AND (
        ${updatedAtMs}::bigint = 0
        OR (extract(epoch from updated_at) * 1000)::bigint <= ${updatedAtMs}::bigint
      )
  `;

  return NextResponse.json({ ok: true });
}
