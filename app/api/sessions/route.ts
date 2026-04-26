import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../lib/auth";
import sql from "../../lib/db";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await sql`
    SELECT id, title, model, mask, memory_prompt, memory_history, last_summarize_index, updated_at,
      jsonb_array_length(messages) AS message_count,
      messages->-1->>'id' AS last_message_id
    FROM chat_sessions
    WHERE user_id = ${user.id}
    ORDER BY updated_at DESC, id DESC
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
