import sql from "./db";

// Each migration is applied exactly once, tracked in schema_migrations.
// Neon's tagged-template client executes one statement per call, so each
// DDL/DML statement is its own `sql` invocation.
const MIGRATIONS: {
  name: string;
  up: (s: typeof sql) => Promise<void>;
}[] = [
  {
    name: "001_chat_messages_table",
    up: async (s) => {
      await s`
        CREATE TABLE IF NOT EXISTS chat_messages (
          session_id  TEXT        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
          id          TEXT        NOT NULL,
          user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          payload     JSONB       NOT NULL,
          seq         BIGINT      NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (session_id, id)
        )
      `;
      await s`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq
          ON chat_messages (session_id, seq)
      `;
      await s`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id
          ON chat_messages (user_id)
      `;
      // Backfill from the legacy JSONB array.  seq = position * 1000 so there
      // is room to insert between rows if ever needed.
      await s`
        INSERT INTO chat_messages (session_id, id, user_id, payload, seq)
        SELECT
          s.id,
          COALESCE(msg->>'id', md5(msg::text)),
          s.user_id,
          msg,
          (ord - 1) * 1000
        FROM chat_sessions s,
             jsonb_array_elements(s.messages) WITH ORDINALITY AS t(msg, ord)
        WHERE jsonb_array_length(s.messages) > 0
        ON CONFLICT (session_id, id) DO NOTHING
      `;
    },
  },
];

let migrationPromise: Promise<void> | null = null;

export function runMigrations(): Promise<void> {
  // Singleton: run once per process, cache the promise so concurrent callers
  // all await the same work.
  if (!migrationPromise) {
    migrationPromise = _runMigrations().catch((e) => {
      migrationPromise = null; // allow retry on next request
      throw e;
    });
  }
  return migrationPromise;
}

async function _runMigrations() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const applied = (await sql`
    SELECT name FROM schema_migrations
  `) as { name: string }[];
  const appliedNames = new Set(applied.map((r) => r.name));

  for (const migration of MIGRATIONS) {
    if (appliedNames.has(migration.name)) continue;
    console.log("[Migration] running", migration.name);
    await migration.up(sql);
    await sql`
      INSERT INTO schema_migrations (name) VALUES (${migration.name})
    `;
    console.log("[Migration] applied", migration.name);
  }
}
