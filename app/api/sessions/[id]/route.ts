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
    SELECT id, title, model, ${
      metaOnly ? sql`NULL::jsonb AS messages` : sql`messages`
    }, mask, memory_prompt, last_summarize_index, updated_at,
      jsonb_array_length(messages) AS message_count,
      (messages->-1->>'id') AS last_message_id
    FROM chat_sessions WHERE id = ${params.id} AND user_id = ${user.id} LIMIT 1
  `;
  if (!rows.length)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (metaOnly) {
    const r = rows[0] as any;
    if (process.env.NODE_ENV !== "production") {
      console.log("[meta]", {
        id: r.id,
        updated_at: r.updated_at,
        message_count: r.message_count ?? 0,
        last_message_id: r.last_message_id ?? "",
      });
    }
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

  const appendMessages = Array.isArray(messages) ? messages : [];
  if (appendMessages.length === 0) {
    return NextResponse.json({ ok: true, appended: 0 });
  }

  const rows = await sql`
    SELECT id, title, model, messages, mask, memory_prompt, memory_history, last_summarize_index
    FROM chat_sessions
    WHERE id = ${params.id} AND user_id = ${user.id}
    LIMIT 1
  `;

  const existing = rows[0];
  if (!existing) {
    await sql`
      INSERT INTO chat_sessions (
        id, user_id, title, messages, model, mask, memory_prompt, memory_history, last_summarize_index
      )
      VALUES (
        ${params.id},
        ${user.id},
        ${title ?? "新的聊天"},
        ${JSON.stringify(appendMessages)},
        ${model ?? ""},
        ${JSON.stringify(mask ?? {})},
        ${memoryPrompt ?? ""},
        ${JSON.stringify(memoryHistory ?? [])},
        ${lastSummarizeIndex ?? 0}
      )
    `;
    return NextResponse.json({ ok: true, appended: appendMessages.length });
  }

  const existingMessages = Array.isArray(existing.messages)
    ? existing.messages
    : [];
  const seenIds = new Set<string>(
    existingMessages.map((m: any) => (typeof m?.id === "string" ? m.id : "")),
  );
  const mergedMessages = [...existingMessages];
  let appended = 0;
  for (const msg of appendMessages) {
    const id = typeof msg?.id === "string" ? msg.id : "";
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    mergedMessages.push(msg);
    appended += 1;
  }

  await sql`
    UPDATE chat_sessions
    SET
      title = ${title ?? existing.title ?? "新的聊天"},
      messages = ${JSON.stringify(mergedMessages)},
      model = ${model ?? existing.model ?? ""},
      mask = ${JSON.stringify(mask ?? existing.mask ?? {})},
      memory_prompt = ${memoryPrompt ?? existing.memory_prompt ?? ""},
      memory_history = ${JSON.stringify(
        memoryHistory ?? existing.memory_history ?? [],
      )},
      last_summarize_index = ${
        lastSummarizeIndex ?? existing.last_summarize_index ?? 0
      },
      updated_at = NOW()
    WHERE id = ${params.id} AND user_id = ${user.id}
  `;

  return NextResponse.json({ ok: true, appended });
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
    SELECT id
    FROM chat_sessions
    WHERE id = ${params.id} AND user_id = ${user.id}
    LIMIT 1
  `;

  if (!rows.length) {
    await sql`
      INSERT INTO chat_sessions (
        id, user_id, title, messages, model, mask, memory_prompt, memory_history, last_summarize_index
      )
      VALUES (
        ${params.id},
        ${user.id},
        ${title ?? "新的聊天"},
        '[]'::jsonb,
        ${model ?? ""},
        ${JSON.stringify(mask ?? {})},
        ${memoryPrompt ?? ""},
        ${JSON.stringify(memoryHistory ?? [])},
        ${lastSummarizeIndex ?? 0}
      )
    `;
    return NextResponse.json({ ok: true, created: true });
  }

  await sql`
    UPDATE chat_sessions
    SET
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
