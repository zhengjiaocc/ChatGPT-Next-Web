import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../../../lib/auth";
import sql from "../../../../lib/db";
import { runMigrations } from "../../../../lib/migrate";

export const runtime = "edge";

// POST  – upsert a batch of messages (idempotent, incremental)
// DELETE – truncate messages with seq >= a given value (used by resend)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await runMigrations();

    const { messages, title, model, mask } = await req.json();
    const msgs: {
      id: string;
      seq: number;
      payload: Record<string, unknown>;
    }[] = Array.isArray(messages) ? messages : [];

    if (msgs.length === 0) return NextResponse.json({ ok: true, upserted: 0 });

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

    // Upsert each message row.  On conflict we update payload + seq so that
    // edits to an existing message are reflected.
    // We batch via unnest to keep the round-trip count to 1.
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

    // Keep chat_sessions.updated_at fresh so the session list stays sorted.
    await sql`
      UPDATE chat_sessions SET updated_at = NOW()
      WHERE id = ${params.id} AND user_id = ${user.id}
    `;

    console.log(
      "[Sessions][messages] upsert ok",
      `session=${params.id}`,
      `count=${msgs.length}`,
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

// DELETE /api/sessions/[id]/messages?afterSeq=N
// Removes all messages with seq >= N.  Used when the user resends a historical
// message: the client truncates locally then calls this to mirror the cut.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getUser(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await runMigrations();

    const afterSeqParam = req.nextUrl.searchParams.get("afterSeq");
    if (afterSeqParam === null)
      return NextResponse.json({ error: "Missing afterSeq" }, { status: 400 });

    const afterSeq = Number(afterSeqParam);
    if (!Number.isFinite(afterSeq))
      return NextResponse.json({ error: "Invalid afterSeq" }, { status: 400 });

    // Verify session ownership before deleting.
    const rows = await sql`
      SELECT id FROM chat_sessions
      WHERE id = ${params.id} AND user_id = ${user.id}
      LIMIT 1
    `;
    if (!rows.length)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = await sql`
      DELETE FROM chat_messages
      WHERE session_id = ${params.id}
        AND user_id    = ${user.id}
        AND seq        >= ${afterSeq}
    `;

    await sql`
      UPDATE chat_sessions SET updated_at = NOW()
      WHERE id = ${params.id} AND user_id = ${user.id}
    `;

    console.log(
      "[Sessions][messages] truncate ok",
      `session=${params.id}`,
      `afterSeq=${afterSeq}`,
      `deleted=${(result as any).count ?? "?"}`,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[Sessions][messages] truncate failed",
      `session=${params.id}`,
      error,
    );
    return NextResponse.json(
      { error: "Failed to truncate messages" },
      { status: 500 },
    );
  }
}
