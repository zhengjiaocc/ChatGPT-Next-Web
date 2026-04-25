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

  const {
    title,
    messages,
    model,
    mask,
    memoryPrompt,
    memoryHistory,
    lastSummarizeIndex,
  } = await req.json();

  const msgs = Array.isArray(messages) ? messages : [];

  await sql`
    INSERT INTO chat_sessions (id, user_id, title, messages, model, mask, memory_prompt, memory_history, last_summarize_index)
    VALUES (
      ${params.id}, ${user.id}, ${title ?? "新的聊天"},
      ${JSON.stringify(msgs)}::jsonb,
      ${model ?? ""}, ${JSON.stringify(mask ?? {})}::jsonb,
      ${memoryPrompt ?? ""}, ${JSON.stringify(memoryHistory ?? [])}::jsonb,
      ${lastSummarizeIndex ?? 0}
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      messages = EXCLUDED.messages,
      model = EXCLUDED.model,
      mask = EXCLUDED.mask,
      memory_prompt = EXCLUDED.memory_prompt,
      memory_history = EXCLUDED.memory_history,
      last_summarize_index = EXCLUDED.last_summarize_index,
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
  } = await req.json();

  const rows = await sql`
    SELECT id FROM chat_sessions WHERE id = ${params.id} AND user_id = ${user.id} LIMIT 1
  `;

  if (!rows.length) {
    await sql`
      INSERT INTO chat_sessions (id, user_id, title, model, mask, memory_prompt, memory_history, last_summarize_index)
      VALUES (
        ${params.id}, ${user.id}, ${title ?? "新的聊天"}, ${model ?? ""},
        ${JSON.stringify(mask ?? {})}, ${memoryPrompt ?? ""},
        ${JSON.stringify(memoryHistory ?? [])}, ${lastSummarizeIndex ?? 0}
      )
    `;
    return NextResponse.json({ ok: true, created: true });
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
    WHERE id = ${params.id} AND user_id = ${user.id}
  `;

  return NextResponse.json({ ok: true });
}
