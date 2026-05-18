-- Migration 001: introduce per-row chat_messages table
--
-- Strategy:
--   1. Create chat_messages with (session_id, id) primary key and a seq
--      column that preserves original ordering.
--   2. Backfill from the existing chat_sessions.messages JSONB array so
--      no history is lost.
--   3. Keep chat_sessions.messages in place for now so a rollback is safe;
--      it will be dropped in a future migration once the new table is stable.

CREATE TABLE IF NOT EXISTS chat_messages (
  session_id  TEXT        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  id          TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload     JSONB       NOT NULL,
  seq         BIGINT      NOT NULL,  -- client-assigned monotonic sequence (nanoid-based timestamp or counter)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, id)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq
  ON chat_messages (session_id, seq);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id
  ON chat_messages (user_id);

-- Backfill existing messages from the JSONB array.
-- Each message gets seq = its 0-based position * 1000 to leave room for
-- future inserts between existing messages if needed.
INSERT INTO chat_messages (session_id, id, user_id, payload, seq)
SELECT
  s.id                                          AS session_id,
  COALESCE(msg->>'id', md5(msg::text))          AS id,
  s.user_id                                     AS user_id,
  msg                                           AS payload,
  (ord - 1) * 1000                              AS seq
FROM chat_sessions s,
     jsonb_array_elements(s.messages) WITH ORDINALITY AS t(msg, ord)
WHERE jsonb_array_length(s.messages) > 0
ON CONFLICT (session_id, id) DO NOTHING;
