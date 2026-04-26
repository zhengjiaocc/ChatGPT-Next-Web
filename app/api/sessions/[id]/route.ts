import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../lib/auth";
import sql from "../../../lib/db";

export const runtime = "edge";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const metaOnly = req.nextUrl.searchParams.get("meta") === "1";
  const rows = await sql`
    SELECT id, title, model, messages, mask, memory_prompt, last_summarize_index, updated_at,
      jsonb_array_length(messages) AS message_count,
      messages->-1->>'id' AS last_message_id
    FROM chat_sessions
    WHERE id = ${params.id} AND user_id = ${user.id}
    LIMIT 1
  `;
  if (!rows.length)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (metaOnly) {
    const r = rows[0] as any;
    return NextResponse.json({
      id: r.id,
      updated_at: r.updated_at,
      message_count: r.message_count ?? 0,
      last_message_id: r.last_message_id ?? "",
    });
  }

  return NextResponse.json(rows[0]);
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
