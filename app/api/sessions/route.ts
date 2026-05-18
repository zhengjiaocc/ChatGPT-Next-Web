import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../lib/auth";
import sql from "../../lib/db";
import { runMigrations } from "../../lib/migrate";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await runMigrations();

  const sessions = await sql`
    SELECT
      s.id, s.title, s.model, s.mask,
      s.memory_prompt, s.memory_history, s.last_summarize_index, s.updated_at,
      COALESCE(m.message_count, 0)  AS message_count,
      COALESCE(m.last_message_id, '') AS last_message_id
    FROM chat_sessions s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS message_count,
        (SELECT id FROM chat_messages
         WHERE session_id = s.id AND user_id = ${user.id}
         ORDER BY seq DESC LIMIT 1) AS last_message_id
      FROM chat_messages
      WHERE session_id = s.id AND user_id = ${user.id}
    ) m ON true
    WHERE s.user_id = ${user.id}
    ORDER BY s.updated_at DESC, s.id DESC
    LIMIT 50
  `;
  return NextResponse.json(sessions);
}

export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  await sql`DELETE FROM chat_sessions WHERE id = ${id} AND user_id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
