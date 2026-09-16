# Saving Playground Conversations — Database Research and Schema

**Question:** which database should store playground conversations (the
user's messages, the AI replies, and everything the router reports about
each reply), and what exactly does each field look like?

**Answer in one line:** SQLite through Node's built-in `node:sqlite`, with a
schema written so that moving to PostgreSQL later is a driver swap.

**Deliverables**
- `backend/src/db/schema.sql` — the full schema, every constraint, triggers, FTS, views
- `backend/test/schemaTest.js` — 30 checks that try to break every rule (`npm run test:schema`)
- this document — the reasoning

---

## 1. What we are actually storing

Today the playground keeps the thread in React state (`useState<ThreadMessage[]>`)
and forgets it on refresh. Forge keys live in `localStorage`. The backend
keeps users and keys in two JSON files.

What a saved conversation needs to hold:

| Thing | Where it comes from |
| --- | --- |
| Who owns it | the logged-in user (`req.user.id`, OAuth session) |
| Which Forge key was used | the playground's key selector |
| The messages, in order | `user` / `assistant` / `system` + text |
| For every AI reply: the routing decision | the `routing` object the gateway returns — tier, model, difficulty, size, tokens, latency, fallback, truncation, context-window details, reasons |
| Running totals per conversation | message count, tokens, estimated cost, last activity |

Two things fall out of this that matter for the choice:

1. **The routing metadata is the valuable part.** It is what makes this
   project different from "a chat app". It needs to be queryable — "how
   many requests went to each tier this week", "average latency per
   model", "how often did we trim". That argues for typed columns, not a
   JSON blob.
2. **Once this exists, `/v1/stats` can be a SQL query** over the same
   table, which fixes the per-tier costing bug in `usageTracker.js` and
   makes the stats survive a restart.

---

## 2. Requirements

| # | Requirement | Why |
| --- | --- | --- |
| R1 | Per-user isolation, enforced by the database not just the app | One developer must never see another's conversations |
| R2 | Ordered messages with no gaps | The thread must replay exactly |
| R3 | Every routing field stored with its real type and range | Analytics; the savings number is the product |
| R4 | Full-text search over message content | "Find that conversation about rate limiters" |
| R5 | Cascade delete (user → keys → conversations → messages → routing) | GDPR-style "delete my account" in one statement |
| R6 | Soft delete + later purge | Undo, and no accidental data loss |
| R7 | Survives container restarts on the existing volume | `docker-compose.yml` already mounts `/app/data` |
| R8 | Zero or near-zero operational cost for a solo project | No second server to keep alive |
| R9 | A clear path to a "real" database when scale demands it | Do not paint into a corner |
| R10 | Also replace `users.json` / `forgeKeys.json` | Two more JSON files with the same concurrency bug |

---

## 3. Options compared

| | SQLite (`node:sqlite`) | PostgreSQL | MongoDB | Redis |
| --- | --- | --- | --- | --- |
| Extra service to run | **none** | yes (container or managed) | yes | yes |
| Dependencies to install | **none** (built into Node 22.13+) | `pg` | `mongodb` | `redis` |
| Fits the current deploy (1 container + volume) | **perfectly** | needs a 2nd container / RDS | needs a 2nd container / Atlas | not a primary store |
| Constraints (CHECK, FK, UNIQUE, triggers) | full | full | app-level only (schema validation is weaker) | none |
| Full-text search | **FTS5 built in** | tsvector + GIN | Atlas Search / text index | no |
| JSON columns | JSON1 built in | JSONB (better) | native | no |
| Ordered messages with no gaps | trigger | trigger | app-level | — |
| Analytics queries (group by tier, by day) | good | **best** | aggregation pipeline | no |
| Concurrent writers | one at a time (WAL makes this fine for an API server) | many | many | many |
| Multi-instance / horizontal scale | no (single file) | **yes** | yes | yes |
| Backups | copy one file | pg_dump / managed snapshots | mongodump / Atlas | — |
| Cost at this project's scale | **$0** | $0 self-hosted, ~$15+/mo managed | similar | — |
| Interview story | "chose the simplest thing that meets every requirement, with a documented migration trigger" | "standard choice" | "document model matches chat" — but embedded arrays grow unbounded | — |

**Why not MongoDB even though "a conversation with messages" looks like a
document?** Because the natural design — a `conversation` document with an
embedded `messages` array — grows without bound, and the routing metadata
you want to aggregate over is then buried inside arrays inside documents.
You end up normalising messages into their own collection anyway, at which
point you have a relational model without relational constraints.

**Why not Postgres from day one?** It is the right eventual answer. But it
adds a second service to run, secure, back up and pay for, for a project
that currently runs as one container with a volume. Every constraint in
the schema below works identically on both, so the cost of starting with
SQLite is one migration script later — and the trigger for that migration
is written down (section 8).

---

## 4. Recommendation

**SQLite via `node:sqlite`, WAL mode, one file at `data/api-forge.db`.**

Verified on this machine (Node 24.19, SQLite 3.53.3): FTS5 ✅, JSON1 ✅,
CHECK constraints ✅, foreign keys ON by default ✅, cascading deletes ✅,
prepared statements and transactions ✅. No `npm install` needed.

One deployment change: the Dockerfile uses `node:20-alpine`, which predates
`node:sqlite`. Change it to `node:22-alpine` or newer (`node:24-alpine`
recommended — it matches your local version).

`node:sqlite` is marked *Release Candidate* (Stability 1.2) in the Node
docs. If that is a concern, `better-sqlite3` is the drop-in alternative
with an almost identical synchronous API; the schema does not change.

---

## 5. Schema overview

```
users ──1:N──> forge_keys
  │
  └──1:N──> conversations ──1:N──> messages ──1:0..1──> message_routing
                                      │
                                      └── messages_fts (full-text index)
```

- `conversations.forge_key_id` is `ON DELETE SET NULL`: revoking a key does
  not erase the conversations made with it.
- Everything else cascades from `users`: deleting an account removes all
  of their data in one statement (R5).
- `messages` is deliberately narrow (role, content, position). All routing
  metadata is a separate 1:1 table so `user` messages do not carry 25
  NULL columns.

---

## 6. Every field, with its constraint

Types are SQLite's. The Postgres equivalent is in section 8.

### `users` — replaces `data/users.json`

| Field | Type | Constraint | Notes |
| --- | --- | --- | --- |
| `id` | TEXT | PK, length = 36 | UUID v4 |
| `provider` | TEXT | NOT NULL, IN ('google','github') | |
| `provider_id` | TEXT | NOT NULL, 1–128 chars | the id from that provider's profile |
| `email` | TEXT | NULL or (≤ 254 chars AND looks like `_@_`) | GitHub may not return one |
| `name` | TEXT | NOT NULL, 1–120 chars, default 'Unnamed developer' | |
| `avatar_url` | TEXT | NULL or ≤ 2048 chars | |
| `created_at` | TEXT | NOT NULL, ISO-8601 UTC (24 chars), default now | |
| `updated_at` | TEXT | NOT NULL, same format; trigger-maintained | |
| | | **UNIQUE (provider, provider_id)** | one account per OAuth identity |

### `forge_keys` — replaces `data/forgeKeys.json`

| Field | Type | Constraint | Notes |
| --- | --- | --- | --- |
| `id` | TEXT | PK, length = 36 | |
| `user_id` | TEXT | NOT NULL, FK → users **ON DELETE CASCADE** | |
| `name` | TEXT | NOT NULL, 1–100 chars, default 'Unnamed key' | |
| `key_hash` | TEXT | NOT NULL, **UNIQUE**, length = 64 | SHA-256 hex of the raw key. **The raw key is never stored** — this fixes the plaintext-keys problem flagged in the project review |
| `key_prefix` | TEXT | NOT NULL, length = 10 | `forge_ab12` — for display |
| `key_last4` | TEXT | NOT NULL, length = 4 | for display |
| `requests` | INTEGER | NOT NULL, ≥ 0, default 0 | |
| `input_tokens` | INTEGER | NOT NULL, ≥ 0, default 0 | |
| `output_tokens` | INTEGER | NOT NULL, ≥ 0, default 0 | |
| `created_at` | TEXT | NOT NULL, ISO-8601 | |
| `revoked_at` | TEXT | NULL or ISO-8601 | NULL = active. Replaces the `revoked` boolean and records *when* |

Validating a key becomes `SELECT … WHERE key_hash = sha256(raw) AND revoked_at IS NULL` — an indexed lookup instead of a linear scan of a JSON file.

### `conversations`

| Field | Type | Constraint | Notes |
| --- | --- | --- | --- |
| `id` | TEXT | PK, length = 36 | |
| `user_id` | TEXT | NOT NULL, FK → users ON DELETE CASCADE | owner (R1) |
| `forge_key_id` | TEXT | NULL, FK → forge_keys **ON DELETE SET NULL** | which key the playground used |
| `title` | TEXT | NOT NULL, 1–200 chars, default 'New conversation' | auto-set from the first user message; user-editable |
| `model_preference` | TEXT | NOT NULL, IN (the 10 model aliases), default 'auto' | the selector value |
| `message_count` | INTEGER | NOT NULL, ≥ 0 | **trigger-maintained** |
| `total_input_tokens` | INTEGER | NOT NULL, ≥ 0 | trigger-maintained from routing rows |
| `total_output_tokens` | INTEGER | NOT NULL, ≥ 0 | trigger-maintained |
| `estimated_cost_usd` | REAL | NOT NULL, ≥ 0 | trigger-maintained: `(in + out) × cost_per_1k / 1000` |
| `last_message_at` | TEXT | NULL or ISO-8601 | trigger-maintained |
| `created_at` | TEXT | NOT NULL, ISO-8601 | |
| `updated_at` | TEXT | NOT NULL, ISO-8601 | trigger-maintained |
| `archived_at` | TEXT | NULL or ISO-8601 | hidden from the sidebar, still searchable |
| `deleted_at` | TEXT | NULL or ISO-8601 | soft delete (R6). A trigger refuses new messages once set |

Index: `(user_id, updated_at DESC) WHERE deleted_at IS NULL` — the sidebar query is one index range scan.

### `messages`

| Field | Type | Constraint | Notes |
| --- | --- | --- | --- |
| `id` | TEXT | PK, length = 36 | |
| `conversation_id` | TEXT | NOT NULL, FK → conversations ON DELETE CASCADE | |
| `seq` | INTEGER | NOT NULL, ≥ 0, **UNIQUE with conversation_id**, **trigger: must equal MAX(seq)+1** | position; no gaps, no reordering (R2) |
| `role` | TEXT | NOT NULL, IN ('system','user','assistant') | |
| `content` | TEXT | NOT NULL, 1–2,000,000 chars | upper bound = the gateway's 2 MB body limit |
| `content_tokens_est` | INTEGER | NULL or ≥ 0 | from `tokenEstimator.js` at write time |
| `created_at` | TEXT | NOT NULL, ISO-8601 | |

Messages are **immutable**: a trigger refuses `UPDATE` of `content`, `role`, `seq` or `conversation_id`. Editing = appending a new message. This keeps the thread an honest record of what was actually sent to the model.

### `message_routing` — 1:1 with **assistant** messages only

This is the `routing` object from `modelRouter.js`, column by column.

| Field | Type | Constraint | Source |
| --- | --- | --- | --- |
| `message_id` | TEXT | PK, FK → messages ON DELETE CASCADE; **trigger: role must be 'assistant'** | |
| `created_at` | TEXT | NOT NULL, ISO-8601 | denormalised so analytics never need a join |
| `routed_by` | TEXT | NOT NULL, IN ('complexity-analysis','explicit-request') | `routing.routedBy` |
| `tier` | TEXT | NOT NULL, IN ('simple','moderate','complex') | `routing.tier` |
| `difficulty` | INTEGER | NOT NULL, 0–100 | `routing.difficulty` |
| `size` | INTEGER | NOT NULL, 0–100 | `routing.size` |
| `confidence` | REAL | NOT NULL, 0–1 | `routing.confidence` |
| `provider` | TEXT | NOT NULL, IN ('groq','mistral','anthropic','gemini','openai') | `routing.provider` |
| `model` | TEXT | NOT NULL, 1–100 chars | `routing.model` |
| `model_label` | TEXT | NOT NULL, 1–100 chars | `routing.modelLabel` |
| `input_tokens` | INTEGER | NULL or ≥ 0 | `usage.input_tokens` — actual, from the provider |
| `output_tokens` | INTEGER | NULL or ≥ 0 | `usage.output_tokens` |
| `estimated_input_tokens` | INTEGER | NOT NULL, ≥ 0 | `routing.estimatedInputTokens` |
| `estimated_output_tokens` | INTEGER | NOT NULL, ≥ 0 | `routing.estimatedOutputTokens` |
| `max_tokens_out` | INTEGER | NOT NULL, ≥ 0 | `routing.maxTokensOut` |
| `latency_ms` | INTEGER | NOT NULL, ≥ 0 | `routing.latencyMs` |
| `cost_per_1k_tokens` | REAL | NOT NULL, ≥ 0 | `routing.estimatedCostPer1kTokens` |
| `used_fallback` | INTEGER | NOT NULL, 0/1 | `routing.usedFallback` |
| `fallback_reason` | TEXT | NULL or ≤ 2000 chars | `routing.fallbackReason` |
| `truncated` | INTEGER | NOT NULL, 0/1 | `routing.truncated` |
| `finish_reason` | TEXT | NOT NULL, IN ('stop','length','other') | `routing.finishReason` |
| `context_window` | INTEGER | NOT NULL, > 0 | `routing.context.contextWindow` (the effective one) |
| `context_utilization` | REAL | NOT NULL, 0–1 | `routing.context.utilization` |
| `upgraded_model` | INTEGER | NOT NULL, 0/1 | `routing.context.upgradedModel` |
| `retried_on_context_error` | INTEGER | NOT NULL, 0/1 | `routing.context.retriedOnContextError` |
| `trimmed_strategy` | TEXT | NULL or IN ('sliding-window','summarized') | `routing.context.trimmed.strategy` |
| `trimmed_dropped_messages` | INTEGER | NULL or ≥ 0 | `routing.context.trimmed.droppedMessages` |
| `reasons_json` | TEXT | NOT NULL, `json_valid()`, default '[]' | `routing.reasons` |
| `context_json` | TEXT | NOT NULL, `json_valid()`, default '{}' | the whole `routing.context` — the long tail |

Two cross-field rules, as table-level CHECKs:

- `used_fallback = 1 OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL)` — a real reply must report real usage; only a fallback may have NULL tokens.
- `(trimmed_strategy IS NULL) = (trimmed_dropped_messages IS NULL)` — the two trim fields travel together.

Indexes: `(tier, created_at)`, `(provider, model, created_at)`, `(created_at)` — every stats query is index-backed.

### `messages_fts` — full-text search

FTS5 virtual table in *external-content* mode (the text is stored once, in
`messages`), kept in sync by triggers. Tokenizer `unicode61` with
diacritics removed so "resume" finds "résumé".

Query: `SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH ? ORDER BY rank`

---

## 7. Triggers — the rules the app is not trusted to remember

| Trigger | Rule |
| --- | --- |
| `trg_routing_assistant_only` | routing may only attach to an `assistant` message |
| `trg_messages_seq_contiguous` | `seq` must be exactly the next position |
| `trg_messages_no_append_deleted` | no new messages in a soft-deleted conversation |
| `trg_messages_immutable` | content / role / seq / conversation never change |
| `trg_messages_after_insert` | bump `message_count`, set `last_message_at`, `updated_at` |
| `trg_routing_after_insert` | add tokens and cost to the conversation totals |
| `trg_users_updated_at`, `trg_conversations_updated_at` | `updated_at` maintenance |
| `trg_messages_fts_insert/delete` | keep the search index in sync |

The point of putting these in the database rather than the app: the
counters and the search index stay correct even when a future code path
forgets to update them.

**View `v_usage_by_tier`** — requests, real per-tier tokens, actual cost,
fallbacks, truncations, average latency, grouped by tier. This is what
`/v1/stats` should read from.

---

## 8. Moving to PostgreSQL later

**When:** any one of — a second app instance, a database file over ~20 GB,
a need for `pgvector` semantic search, or a managed-backup requirement.

Same table names, same column names, same constraints. Type map:

| SQLite (here) | PostgreSQL |
| --- | --- |
| `TEXT` id, length = 36 | `UUID` |
| `TEXT` ISO-8601 timestamp | `TIMESTAMPTZ` |
| `INTEGER` 0/1 | `BOOLEAN` |
| `TEXT` + `json_valid()` | `JSONB` |
| `REAL` | `DOUBLE PRECISION` (or `NUMERIC(12,8)` for cost) |
| `strftime(...)` default | `now()` |
| `RAISE(ABORT, …)` triggers | `plpgsql` functions raising exceptions |
| `messages_fts` (FTS5) | `content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` + GIN index |
| partial index `WHERE deleted_at IS NULL` | identical syntax |

Estimated effort: one afternoon, mostly the trigger bodies.

---

## 9. Privacy and retention

- **Conversation content is user data, saved on purpose.** The routing log
  (`routingLogger.js`) still hashes prompts; the playground store is
  different because the user explicitly chose to keep the thread.
- **Delete = soft delete first**, then a purge job removes rows where
  `deleted_at < now() - 30 days` (the `idx_conversations_deleted` index
  exists for exactly this).
- **Account deletion** is `DELETE FROM users WHERE id = ?` — everything
  cascades, including the search index. Verified in the test.
- **Encryption at rest:** SQLite does not encrypt. On the current deploy
  that means encrypting the Docker volume / disk. If per-field encryption
  is ever required, encrypt `messages.content` in the app layer and drop
  FTS (you cannot search ciphertext).
- **Never store the raw Forge key.** `key_hash` only.

---

## 10. What the API would look like

All session-authenticated (`requireAuth`), like `/v1/keys`. The playground
already runs behind `ProtectedRoute`, so the session cookie is present.

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/v1/conversations` | create; body `{ title?, forgeKeyId?, modelPreference? }` |
| `GET` | `/v1/conversations?limit=20&cursor=` | sidebar list, newest activity first |
| `GET` | `/v1/conversations/:id` | one conversation with all messages + routing |
| `POST` | `/v1/conversations/:id/messages` | append the user message, call the gateway, append the reply + routing — **one transaction** |
| `PATCH` | `/v1/conversations/:id` | title / archive / model preference |
| `DELETE` | `/v1/conversations/:id` | soft delete |
| `GET` | `/v1/conversations/search?q=` | FTS across the user's own messages |

Ownership is enforced by adding `AND user_id = ?` to every query, the same
way `keyStore.js` filters by `userId` today.

One design note on the message endpoint: for a logged-in playground user,
the server does **not** need the raw Forge key to call the gateway — it
owns the upstream keys. It just needs to attribute usage to a key the user
owns (`forge_key_id`). So the playground stops needing to keep raw keys in
`localStorage` for its own use; that store becomes purely a convenience
for copying keys into external apps.

---

## 11. Migrating the two existing JSON files

`data/users.json` → `users`: straight copy; fields map 1:1.

`data/forgeKeys.json` → `forge_keys`: hash each raw key with SHA-256, keep
`key.slice(0,10)` and `key.slice(-4)` for display, map `revoked: true` to
`revoked_at = now()`. **After this, raw keys are gone from disk.** Existing
developers' keys keep working because validation compares hashes.

Run once at startup if the `.db` file does not exist and the JSON files
do; then rename the JSON files to `.migrated`.

---

## 12. Verified facts (not assumptions)

| Claim | How verified |
| --- | --- |
| `node:sqlite` needs no install and has FTS5, JSON1, CHECK, FK cascade | ran on this machine, Node 24.19, SQLite 3.53.3 |
| `node:sqlite` added v22.5, unflagged v22.13 / v23.4, status Release Candidate | nodejs.org/api/sqlite.html |
| Every constraint and trigger in `schema.sql` actually rejects bad data | `npm run test:schema` — 30/30 |
| Cascade delete clears keys, conversations, messages, routing **and** the FTS index | schemaTest.js, last case |
| Dockerfile is on `node:20-alpine`, which lacks `node:sqlite` | read the file |
