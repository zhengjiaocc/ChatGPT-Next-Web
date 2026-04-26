import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../../lib/auth";
import sql from "../../../../lib/db";

export const runtime = "edge";

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
