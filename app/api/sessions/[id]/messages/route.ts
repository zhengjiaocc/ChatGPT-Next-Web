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

  try {
    const { title, messages, model, mask, mode } = await req.json();
    const msgs = Array.isArray(messages) ? messages : [];
    const syncMode: "append" | "replace" =
      mode === "replace" ? "replace" : "append";

    console.log(
      "[Sessions][messages] upsert start",
      `session=${params.id}`,
      `user=${user.id}`,
      `count=${msgs.length}`,
      `mode=${syncMode}`,
    );

    if (syncMode === "replace") {
      await sql`
        INSERT INTO chat_sessions (id, user_id, title, messages, model, mask)
        VALUES (
          ${params.id}, ${user.id}, ${title ?? "新的聊天"},
          ${JSON.stringify(msgs)}::jsonb,
          ${model ?? ""}, ${JSON.stringify(mask ?? {})}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          messages = EXCLUDED.messages,
          model = EXCLUDED.model,
          mask = EXCLUDED.mask,
          updated_at = NOW()
        WHERE chat_sessions.user_id = ${user.id}
      `;
    } else {
      await sql`
        INSERT INTO chat_sessions (id, user_id, title, messages, model, mask)
        VALUES (
          ${params.id}, ${user.id}, ${title ?? "新的聊天"},
          ${JSON.stringify(msgs)}::jsonb,
          ${model ?? ""}, ${JSON.stringify(mask ?? {})}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          messages = (
            SELECT COALESCE(jsonb_agg(msg ORDER BY ord), '[]'::jsonb)
            FROM (
              SELECT DISTINCT ON (msg_id) msg_id, msg, ord
              FROM (
                SELECT
                  COALESCE(old_msg->>'id', md5(old_msg::text)) AS msg_id,
                  old_msg AS msg,
                  old_ord::bigint AS ord
                FROM jsonb_array_elements(chat_sessions.messages) WITH ORDINALITY AS old_t(old_msg, old_ord)
                UNION ALL
                SELECT
                  COALESCE(new_msg->>'id', md5(new_msg::text)) AS msg_id,
                  new_msg AS msg,
                  (1000000000 + new_ord)::bigint AS ord
                FROM jsonb_array_elements(EXCLUDED.messages) WITH ORDINALITY AS new_t(new_msg, new_ord)
              ) merged
              ORDER BY msg_id, ord DESC
            ) dedup
          ),
          model = EXCLUDED.model,
          mask = EXCLUDED.mask,
          updated_at = NOW()
        WHERE chat_sessions.user_id = ${user.id}
      `;
    }

    console.log(
      "[Sessions][messages] upsert ok",
      `session=${params.id}`,
      `count=${msgs.length}`,
      `mode=${syncMode}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[Sessions][messages] upsert failed",
      `session=${params.id}`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to persist messages" },
      { status: 500 },
    );
  }
}
