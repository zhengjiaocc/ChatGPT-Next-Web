import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../lib/auth";
import sql from "../../../lib/db";
import { runMigrations } from "../../../lib/migrate";

export const runtime = "edge";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await runMigrations();

  const metaOnly = req.nextUrl.searchParams.get("meta") === "1";

  const sessionRows = await sql`
    SELECT id, title, model, mask, memory_prompt, memory_history,
           last_summarize_index, updated_at
    FROM chat_sessions
    WHERE id = ${params.id} AND user_id = ${user.id}
    LIMIT 1
  `;
  if (!sessionRows.length)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = sessionRows[0] as any;

  // Count and last id come from the new messages table.
  const countRows = await sql`
    SELECT COUNT(*)::int AS message_count,
           MAX(id) FILTER (WHERE seq = (SELECT MAX(seq) FROM chat_messages WHERE session_id = ${params.id})) AS last_message_id
    FROM chat_messages
    WHERE session_id = ${params.id} AND user_id = ${user.id}
  `;
  const { message_count, last_message_id } = (countRows[0] as any) ?? {};

  if (metaOnly) {
    return NextResponse.json({
      id: session.id,
      updated_at: session.updated_at,
      message_count: message_count ?? 0,
      last_message_id: last_message_id ?? "",
    });
  }

  // Full load: read messages from the dedicated table, ordered by seq.
  const msgRows = await sql`
    SELECT payload
    FROM chat_messages
    WHERE session_id = ${params.id} AND user_id = ${user.id}
    ORDER BY seq ASC
  `;
  const messages = msgRows.map((r: any) => r.payload);

  return NextResponse.json({ ...session, messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, messages, model, mask } = await req.json();

  const msgs = Array.isArray(messages) ? messages : [];

  await sql`
    INSERT INTO chat_sessions (id, user_id, title, messages, model, mask)
    VALUES (
      ${params.id}, ${user.id}, ${title ?? "新的聊天"},
      ${JSON.stringify(msgs)}::jsonb,
      ${model ?? ""}, ${JSON.stringify(mask ?? {})}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      messages = CASE WHEN jsonb_array_length(EXCLUDED.messages) > 0 THEN EXCLUDED.messages ELSE chat_sessions.messages END,
      model = EXCLUDED.model,
      mask = EXCLUDED.mask,
      updated_at = NOW()
    WHERE chat_sessions.user_id = ${user.id}
  `;

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    title,
    model,
    mask,
    memoryPrompt,
    memoryHistory,
    lastSummarizeIndex,
    updatedAt,
  } = await req.json();
  const updatedAtMs = Number.isFinite(Number(updatedAt))
    ? Math.max(0, Math.floor(Number(updatedAt)))
    : 0;

  const rows = await sql`
    SELECT id FROM chat_sessions WHERE id = ${params.id} AND user_id = ${user.id} LIMIT 1
  `;

  if (!rows.length) {
    // Do NOT create sessions via PATCH.
    // This prevents deleted sessions from being resurrected by delayed/stale PATCH requests.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await sql`
    UPDATE chat_sessions SET
      title = COALESCE(${title}, title),
      model = COALESCE(${model}, model),
      mask = COALESCE(${JSON.stringify(mask ?? null)}::jsonb, mask),
      memory_prompt = COALESCE(${memoryPrompt}, memory_prompt),
      memory_history = COALESCE(${JSON.stringify(
        memoryHistory ?? null,
      )}::jsonb, memory_history),
      last_summarize_index = COALESCE(${lastSummarizeIndex}, last_summarize_index),
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await sql`DELETE FROM chat_sessions WHERE id = ${params.id} AND user_id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
