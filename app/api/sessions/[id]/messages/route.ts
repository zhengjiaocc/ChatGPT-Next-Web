import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../../lib/auth";
import sql from "../../../../lib/db";
import { runMigrations } from "../../../../lib/migrate";

export const runtime = "edge";

// POST – upsert a batch of messages (idempotent, incremental).
//
// Optional body field `truncateAfterMessageId`: if provided, the server
// atomically deletes all messages with seq >= the seq of that message
// before upserting the new batch.  This makes resend a single round-trip
// with no race condition between a separate DELETE and POST.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await runMigrations();

    const { messages, title, model, mask, truncateAfterMessageId } =
      await req.json();
    const msgs: {
      id: string;
      seq: number;
      payload: Record<string, unknown>;
    }[] = Array.isArray(messages) ? messages : [];

    // Ensure the session row exists before inserting messages (FK constraint).
    await sql`
      INSERT INTO chat_sessions (id, user_id, title, model, mask)
      VALUES (
        ${params.id}, ${user.id}, ${title ?? "新的聊天"},
        ${model ?? ""}, ${JSON.stringify(mask ?? {})}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        title      = COALESCE(EXCLUDED.title, chat_sessions.title),
        model      = COALESCE(EXCLUDED.model, chat_sessions.model),
        mask       = COALESCE(EXCLUDED.mask,  chat_sessions.mask),
        updated_at = NOW()
      WHERE chat_sessions.user_id = ${user.id}
    `;

    // Atomic truncate: delete messages with seq >= the anchor message's seq.
    // This runs before the upsert so the new messages land cleanly.
    if (truncateAfterMessageId) {
      await sql`
        DELETE FROM chat_messages
        WHERE session_id = ${params.id}
          AND user_id    = ${user.id}
          AND seq >= (
            SELECT seq FROM chat_messages
            WHERE session_id = ${params.id}
              AND user_id    = ${user.id}
              AND id         = ${truncateAfterMessageId}
            LIMIT 1
          )
      `;
    }

    if (msgs.length === 0) {
      await sql`UPDATE chat_sessions SET updated_at = NOW() WHERE id = ${params.id} AND user_id = ${user.id}`;
      return NextResponse.json({ ok: true, upserted: 0 });
    }

    const ids = msgs.map((m) => m.id);
    const seqs = msgs.map((m) => m.seq);
    const payloads = msgs.map((m) => JSON.stringify(m.payload));

    await sql`
      INSERT INTO chat_messages (session_id, id, user_id, payload, seq)
      SELECT
        ${params.id},
        u.id,
        ${user.id},
        u.payload::jsonb,
        u.seq
      FROM unnest(
        ${ids}::text[],
        ${payloads}::text[],
        ${seqs}::bigint[]
      ) AS u(id, payload, seq)
      ON CONFLICT (session_id, id) DO UPDATE SET
        payload    = EXCLUDED.payload,
        seq        = EXCLUDED.seq,
        updated_at = NOW()
    `;

    await sql`
      UPDATE chat_sessions SET updated_at = NOW()
      WHERE id = ${params.id} AND user_id = ${user.id}
    `;

    console.log(
      "[Sessions][messages] upsert ok",
      `session=${params.id}`,
      `count=${msgs.length}`,
      truncateAfterMessageId ? `truncateAfter=${truncateAfterMessageId}` : "",
    );
    return NextResponse.json({ ok: true, upserted: msgs.length });
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
