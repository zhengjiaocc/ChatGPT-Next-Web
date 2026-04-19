import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../lib/auth";
import sql from "../../../lib/db";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await sql`
    SELECT id, title, model, mask, memory_prompt, last_summarize_index, updated_at,
      jsonb_array_length(messages) AS message_count
    FROM chat_sessions
    WHERE user_id = ${user.id} ORDER BY updated_at DESC
  `;
  return NextResponse.json(sessions);
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, title, messages, model, mask, memoryPrompt, lastSummarizeIndex } =
    await req.json();
  await sql`
    INSERT INTO chat_sessions (id, user_id, title, messages, model, mask, memory_prompt, last_summarize_index)
    VALUES (${id}, ${user.id}, ${title}, ${JSON.stringify(
      messages,
    )}, ${model}, ${JSON.stringify(mask)}, ${memoryPrompt ?? ""}, ${
      lastSummarizeIndex ?? 0
    })
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      messages = EXCLUDED.messages,
      model = EXCLUDED.model,
      mask = EXCLUDED.mask,
      memory_prompt = EXCLUDED.memory_prompt,
      last_summarize_index = EXCLUDED.last_summarize_index,
      updated_at = NOW()
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await sql`DELETE FROM chat_sessions WHERE id = ${id} AND user_id = ${user.id}`;
  return NextResponse.json({ ok: true });
}
