-- ============================================================================
-- API Forge — conversation storage schema
--
-- Written for SQLite (node:sqlite, Node 22.13+). Every type and constraint
-- here has a direct PostgreSQL equivalent; see the migration map in
-- docs/conversation-storage.md. Table and column names are shared so that
-- moving to Postgres later is a driver swap, not a rewrite.
--
-- Conventions
--   ids          TEXT, UUID v4 from crypto.randomUUID()   (36 chars)
--   timestamps   TEXT, ISO-8601 UTC "YYYY-MM-DDTHH:MM:SS.sssZ" (24 chars)
--   booleans     INTEGER 0/1 with a CHECK
--   json         TEXT with CHECK(json_valid(...))
--   soft delete  deleted_at IS NULL means live
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ----------------------------------------------------------------------------
-- users  (replaces data/users.json)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY
                CHECK (length(id) = 36),
  provider      TEXT NOT NULL
                CHECK (provider IN ('google', 'github')),
  provider_id   TEXT NOT NULL
                CHECK (length(provider_id) BETWEEN 1 AND 128),
  email         TEXT
                CHECK (email IS NULL OR (length(email) <= 254 AND email LIKE '%_@_%')),
  name          TEXT NOT NULL DEFAULT 'Unnamed developer'
                CHECK (length(name) BETWEEN 1 AND 120),
  avatar_url    TEXT
                CHECK (avatar_url IS NULL OR length(avatar_url) <= 2048),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (length(created_at) = 24),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                CHECK (length(updated_at) = 24),
  UNIQUE (provider, provider_id)
);

-- ----------------------------------------------------------------------------
-- forge_keys  (replaces data/forgeKeys.json)
-- The raw key is NEVER stored. key_hash = sha256(raw); prefix/last4 are for
-- display only ("forge_ab12…wx9z").
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forge_keys (
  id             TEXT PRIMARY KEY
                 CHECK (length(id) = 36),
  user_id        TEXT NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT 'Unnamed key'
                 CHECK (length(name) BETWEEN 1 AND 100),
  key_hash       TEXT NOT NULL UNIQUE
                 CHECK (length(key_hash) = 64),          -- sha256 hex
  key_prefix     TEXT NOT NULL
                 CHECK (length(key_prefix) = 10),        -- "forge_" + 4
  key_last4      TEXT NOT NULL
                 CHECK (length(key_last4) = 4),
  requests       INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  input_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 CHECK (length(created_at) = 24),
  revoked_at     TEXT
                 CHECK (revoked_at IS NULL OR length(revoked_at) = 24)
);

CREATE INDEX IF NOT EXISTS idx_forge_keys_user
  ON forge_keys (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- conversations
-- One playground thread. Counters are denormalised for the list view and
-- kept correct by triggers on `messages` (see below), not by the app.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                   TEXT PRIMARY KEY
                       CHECK (length(id) = 36),
  user_id              TEXT NOT NULL
                       REFERENCES users(id) ON DELETE CASCADE,
  -- Which Forge key the playground used. SET NULL so revoking a key does
  -- not erase the conversations made with it.
  forge_key_id         TEXT
                       REFERENCES forge_keys(id) ON DELETE SET NULL,
  title                TEXT NOT NULL DEFAULT 'New conversation'
                       CHECK (length(title) BETWEEN 1 AND 200),
  -- The playground's model selector value at the time of the last message.
  model_preference     TEXT NOT NULL DEFAULT 'auto'
                       CHECK (model_preference IN (
                         'auto', 'haiku', 'sonnet', 'opus',
                         'groq-fast', 'groq-strong',
                         'gemini-flash', 'gemini-pro',
                         'mistral-small', 'mistral-large')),
  message_count        INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  total_input_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (total_input_tokens >= 0),
  total_output_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (total_output_tokens >= 0),
  estimated_cost_usd   REAL    NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  last_message_at      TEXT
                       CHECK (last_message_at IS NULL OR length(last_message_at) = 24),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                       CHECK (length(created_at) = 24),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                       CHECK (length(updated_at) = 24),
  archived_at          TEXT
                       CHECK (archived_at IS NULL OR length(archived_at) = 24),
  deleted_at           TEXT
                       CHECK (deleted_at IS NULL OR length(deleted_at) = 24)
);

-- The sidebar query: "my live conversations, newest activity first".
CREATE INDEX IF NOT EXISTS idx_conversations_user_live
  ON conversations (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Purge job: "soft-deleted more than N days ago".
CREATE INDEX IF NOT EXISTS idx_conversations_deleted
  ON conversations (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- messages
-- Narrow on purpose: role + content + position. Everything the router
-- reports about an assistant reply lives in message_routing (1:1).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY
                      CHECK (length(id) = 36),
  conversation_id     TEXT NOT NULL
                      REFERENCES conversations(id) ON DELETE CASCADE,
  -- Position within the conversation, 0-based, no gaps (enforced by trigger).
  seq                 INTEGER NOT NULL CHECK (seq >= 0),
  role                TEXT NOT NULL
                      CHECK (role IN ('system', 'user', 'assistant')),
  -- Upper bound matches the gateway's 2 MB request body limit.
  content             TEXT NOT NULL
                      CHECK (length(content) BETWEEN 1 AND 2000000),
  -- Local estimate at write time (tokenEstimator.js); NULL if not computed.
  content_tokens_est  INTEGER
                      CHECK (content_tokens_est IS NULL OR content_tokens_est >= 0),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                      CHECK (length(created_at) = 24),
  UNIQUE (conversation_id, seq)
);

-- "Load a conversation" is one range scan on this index.
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, seq);

-- ----------------------------------------------------------------------------
-- message_routing  (1:1 with assistant messages)
-- The `routing` object the gateway returns, as typed columns for everything
-- we aggregate on, plus two JSON columns for the long tail (reasons[],
-- context{}). Typed columns make /v1/stats a plain SQL query and fix the
-- per-tier token bug in usageTracker.js for good.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_routing (
  message_id                TEXT PRIMARY KEY
                            REFERENCES messages(id) ON DELETE CASCADE,
  -- Denormalised for analytics indexes (no join needed for "by day").
  created_at                TEXT NOT NULL
                            CHECK (length(created_at) = 24),
  routed_by                 TEXT NOT NULL
                            CHECK (routed_by IN ('complexity-analysis', 'explicit-request')),
  tier                      TEXT NOT NULL
                            CHECK (tier IN ('simple', 'moderate', 'complex')),
  difficulty                INTEGER NOT NULL CHECK (difficulty BETWEEN 0 AND 100),
  size                      INTEGER NOT NULL CHECK (size BETWEEN 0 AND 100),
  confidence                REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  provider                  TEXT NOT NULL
                            CHECK (provider IN ('groq', 'mistral', 'anthropic', 'gemini', 'openai')),
  model                     TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  model_label               TEXT NOT NULL CHECK (length(model_label) BETWEEN 1 AND 100),
  -- Actual counts from the provider; NULL when the fallback path was used.
  input_tokens              INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens             INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_input_tokens    INTEGER NOT NULL CHECK (estimated_input_tokens >= 0),
  estimated_output_tokens   INTEGER NOT NULL CHECK (estimated_output_tokens >= 0),
  max_tokens_out            INTEGER NOT NULL CHECK (max_tokens_out >= 0),
  latency_ms                INTEGER NOT NULL CHECK (latency_ms >= 0),
  cost_per_1k_tokens        REAL    NOT NULL CHECK (cost_per_1k_tokens >= 0),
  used_fallback             INTEGER NOT NULL DEFAULT 0 CHECK (used_fallback IN (0, 1)),
  fallback_reason           TEXT CHECK (fallback_reason IS NULL OR length(fallback_reason) <= 2000),
  truncated                 INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  finish_reason             TEXT NOT NULL
                            CHECK (finish_reason IN ('stop', 'length', 'other')),
  context_window            INTEGER NOT NULL CHECK (context_window > 0),
  context_utilization       REAL    NOT NULL CHECK (context_utilization BETWEEN 0 AND 1),
  upgraded_model            INTEGER NOT NULL DEFAULT 0 CHECK (upgraded_model IN (0, 1)),
  retried_on_context_error  INTEGER NOT NULL DEFAULT 0 CHECK (retried_on_context_error IN (0, 1)),
  trimmed_strategy          TEXT CHECK (trimmed_strategy IS NULL OR trimmed_strategy IN ('sliding-window', 'summarized')),
  trimmed_dropped_messages  INTEGER CHECK (trimmed_dropped_messages IS NULL OR trimmed_dropped_messages >= 0),
  reasons_json              TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json)),
  context_json              TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json)),
  -- A fallback reply has no real usage; a real reply must report finish_reason.
  CHECK (used_fallback = 1 OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL)),
  -- trimmed_* travel together.
  CHECK ((trimmed_strategy IS NULL) = (trimmed_dropped_messages IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_routing_tier_time     ON message_routing (tier, created_at);
CREATE INDEX IF NOT EXISTS idx_routing_provider_time ON message_routing (provider, model, created_at);
CREATE INDEX IF NOT EXISTS idx_routing_time          ON message_routing (created_at);

-- ----------------------------------------------------------------------------
-- Full-text search over message content (SQLite FTS5, external-content mode
-- so the text is stored once). Postgres: tsvector column + GIN index.
-- ----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content = 'messages',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

-- ============================================================================
-- Triggers — the rules the app is not trusted to remember
-- ============================================================================

-- Only assistant messages carry routing metadata.
CREATE TRIGGER IF NOT EXISTS trg_routing_assistant_only
BEFORE INSERT ON message_routing
BEGIN
  SELECT CASE
    WHEN (SELECT role FROM messages WHERE id = NEW.message_id) <> 'assistant'
    THEN RAISE(ABORT, 'message_routing: message must have role = assistant')
  END;
END;

-- seq must be exactly the next position (no gaps, no reordering).
CREATE TRIGGER IF NOT EXISTS trg_messages_seq_contiguous
BEFORE INSERT ON messages
BEGIN
  SELECT CASE
    WHEN NEW.seq <> (SELECT COALESCE(MAX(seq) + 1, 0) FROM messages WHERE conversation_id = NEW.conversation_id)
    THEN RAISE(ABORT, 'messages: seq must be the next position in the conversation')
  END;
END;

-- Cannot append to a soft-deleted conversation.
CREATE TRIGGER IF NOT EXISTS trg_messages_no_append_deleted
BEFORE INSERT ON messages
BEGIN
  SELECT CASE
    WHEN (SELECT deleted_at FROM conversations WHERE id = NEW.conversation_id) IS NOT NULL
    THEN RAISE(ABORT, 'messages: conversation is deleted')
  END;
END;

-- Messages are immutable once written (edit = new message).
CREATE TRIGGER IF NOT EXISTS trg_messages_immutable
BEFORE UPDATE OF content, role, seq, conversation_id ON messages
BEGIN
  SELECT RAISE(ABORT, 'messages: content, role, seq and conversation_id are immutable');
END;

-- Keep conversation counters and activity timestamps correct.
CREATE TRIGGER IF NOT EXISTS trg_messages_after_insert
AFTER INSERT ON messages
BEGIN
  UPDATE conversations
     SET message_count   = message_count + 1,
         last_message_at = NEW.created_at,
         updated_at      = NEW.created_at
   WHERE id = NEW.conversation_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_routing_after_insert
AFTER INSERT ON message_routing
BEGIN
  UPDATE conversations
     SET total_input_tokens  = total_input_tokens  + COALESCE(NEW.input_tokens, 0),
         total_output_tokens = total_output_tokens + COALESCE(NEW.output_tokens, 0),
         estimated_cost_usd  = estimated_cost_usd
           + (COALESCE(NEW.input_tokens, 0) + COALESCE(NEW.output_tokens, 0)) * NEW.cost_per_1k_tokens / 1000.0
   WHERE id = (SELECT conversation_id FROM messages WHERE id = NEW.message_id);
END;

-- updated_at maintenance on the parent rows.
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_conversations_updated_at
AFTER UPDATE OF title, model_preference, archived_at, forge_key_id ON conversations
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- Keep the FTS index in sync with messages.
CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert
AFTER INSERT ON messages
BEGIN
  INSERT INTO messages_fts (rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete
AFTER DELETE ON messages
BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
END;

-- ============================================================================
-- Views — /v1/stats becomes a query instead of an in-memory counter
-- ============================================================================

-- Per-tier usage with REAL per-tier tokens (fixes the global-average bug).
CREATE VIEW IF NOT EXISTS v_usage_by_tier AS
SELECT
  tier,
  COUNT(*)                                     AS requests,
  SUM(COALESCE(input_tokens, 0))               AS input_tokens,
  SUM(COALESCE(output_tokens, 0))              AS output_tokens,
  SUM((COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) * cost_per_1k_tokens / 1000.0)
                                               AS actual_cost_usd,
  SUM(used_fallback)                           AS fallbacks,
  SUM(truncated)                               AS truncated,
  AVG(latency_ms)                              AS avg_latency_ms
FROM message_routing
GROUP BY tier;
