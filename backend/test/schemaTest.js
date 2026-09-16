/**
 * schemaTest.js
 *
 * Loads src/db/schema.sql into an in-memory SQLite database and then tries
 * to BREAK every rule in it. A constraint that lets bad data through is a
 * failure. Also checks the triggers do their bookkeeping.
 *
 *   npm run test:schema
 *
 * Requires Node 22.13+ (node:sqlite). No dependencies.
 */

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const GREEN = "\x1b[32m", RED = "\x1b[31m", RESET = "\x1b[0m";
const now = () => new Date().toISOString();

const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8"));

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`${GREEN}PASS${RESET}  ${name}`); }
  catch (e) { failed++; console.log(`${RED}FAIL${RESET}  ${name}\n      ${RED}${e.message}${RESET}`); }
}
/** Asserts that running `sql` with `params` is REJECTED by the database. */
function rejects(name, sql, params = [], expectMsg) {
  ok(name, () => {
    let threw = null;
    try { db.prepare(sql).run(...params); } catch (e) { threw = e; }
    if (!threw) throw new Error("was accepted, expected rejection");
    if (expectMsg && !threw.message.includes(expectMsg)) throw new Error(`rejected for the wrong reason: ${threw.message}`);
  });
}

// ── seed one valid user, key, conversation ─────────────────────────────
const userId = randomUUID(), keyId = randomUUID(), convId = randomUUID();
db.prepare("INSERT INTO users (id, provider, provider_id, email, name) VALUES (?,?,?,?,?)")
  .run(userId, "github", "84792582", "dev@example.com", "Dev");
db.prepare("INSERT INTO forge_keys (id, user_id, name, key_hash, key_prefix, key_last4) VALUES (?,?,?,?,?,?)")
  .run(keyId, userId, "playground", "a".repeat(64), "forge_ab12", "wx9z");
db.prepare("INSERT INTO conversations (id, user_id, forge_key_id, title) VALUES (?,?,?,?)")
  .run(convId, userId, keyId, "Migration planning");

function addMessage(role, content, seq, conv = convId) {
  const id = randomUUID();
  db.prepare("INSERT INTO messages (id, conversation_id, seq, role, content, content_tokens_est) VALUES (?,?,?,?,?,?)")
    .run(id, conv, seq, role, content, Math.ceil(content.length / 4));
  return id;
}
function addRouting(messageId, overrides = {}) {
  const r = {
    message_id: messageId, created_at: now(), routed_by: "complexity-analysis", tier: "simple",
    difficulty: 5, size: 5, confidence: 1, provider: "groq", model: "openai/gpt-oss-20b",
    model_label: "Groq GPT-OSS 20B (fast)", input_tokens: 72, output_tokens: 43,
    estimated_input_tokens: 17, estimated_output_tokens: 800, max_tokens_out: 8192,
    latency_ms: 624, cost_per_1k_tokens: 0.000375, used_fallback: 0, fallback_reason: null,
    truncated: 0, finish_reason: "stop", context_window: 8000, context_utilization: 0.02,
    upgraded_model: 0, retried_on_context_error: 0, trimmed_strategy: null,
    trimmed_dropped_messages: null, reasons_json: '["matched a trivial-intent pattern"]',
    context_json: '{"inputTokens":17}', ...overrides,
  };
  const cols = Object.keys(r);
  db.prepare(`INSERT INTO message_routing (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...cols.map((c) => r[c]));
}

console.log("\nSchema — constraint results\n");

// ── users ──────────────────────────────────────────────────────────────
rejects("users: provider must be google|github",
  "INSERT INTO users (id, provider, provider_id) VALUES (?,?,?)", [randomUUID(), "twitter", "1"], "CHECK");
rejects("users: (provider, provider_id) unique",
  "INSERT INTO users (id, provider, provider_id) VALUES (?,?,?)", [randomUUID(), "github", "84792582"], "UNIQUE");
rejects("users: email must look like an email",
  "INSERT INTO users (id, provider, provider_id, email) VALUES (?,?,?,?)", [randomUUID(), "github", "2", "not-an-email"], "CHECK");
rejects("users: id must be a 36-char uuid",
  "INSERT INTO users (id, provider, provider_id) VALUES (?,?,?)", ["short", "github", "3"], "CHECK");

// ── forge_keys ─────────────────────────────────────────────────────────
rejects("forge_keys: key_hash must be 64 hex chars",
  "INSERT INTO forge_keys (id, user_id, key_hash, key_prefix, key_last4) VALUES (?,?,?,?,?)",
  [randomUUID(), userId, "forge_rawkey", "forge_ab12", "wx9z"], "CHECK");
rejects("forge_keys: key_hash unique",
  "INSERT INTO forge_keys (id, user_id, key_hash, key_prefix, key_last4) VALUES (?,?,?,?,?)",
  [randomUUID(), userId, "a".repeat(64), "forge_ab12", "wx9z"], "UNIQUE");
rejects("forge_keys: user must exist (FK)",
  "INSERT INTO forge_keys (id, user_id, key_hash, key_prefix, key_last4) VALUES (?,?,?,?,?)",
  [randomUUID(), randomUUID(), "b".repeat(64), "forge_ab12", "wx9z"], "FOREIGN KEY");
rejects("forge_keys: counters cannot go negative",
  "UPDATE forge_keys SET requests = -1 WHERE id = ?", [keyId], "CHECK");

// ── conversations ──────────────────────────────────────────────────────
rejects("conversations: title 1..200 chars",
  "INSERT INTO conversations (id, user_id, title) VALUES (?,?,?)", [randomUUID(), userId, ""], "CHECK");
rejects("conversations: model_preference must be a known alias",
  "INSERT INTO conversations (id, user_id, model_preference) VALUES (?,?,?)", [randomUUID(), userId, "gpt-4"], "CHECK");
rejects("conversations: user must exist (FK)",
  "INSERT INTO conversations (id, user_id) VALUES (?,?)", [randomUUID(), randomUUID()], "FOREIGN KEY");

// ── messages ───────────────────────────────────────────────────────────
rejects("messages: role must be system|user|assistant",
  "INSERT INTO messages (id, conversation_id, seq, role, content) VALUES (?,?,?,?,?)",
  [randomUUID(), convId, 0, "tool", "x"], "CHECK");
rejects("messages: content cannot be empty",
  "INSERT INTO messages (id, conversation_id, seq, role, content) VALUES (?,?,?,?,?)",
  [randomUUID(), convId, 0, "user", ""], "CHECK");
rejects("messages: seq must be the next position (trigger) — 5 when 0 expected",
  "INSERT INTO messages (id, conversation_id, seq, role, content) VALUES (?,?,?,?,?)",
  [randomUUID(), convId, 5, "user", "hi"], "next position");

const m0 = addMessage("user", "We are planning a database migration.", 0);
const m1 = addMessage("assistant", "Understood. What database?", 1);

rejects("messages: (conversation_id, seq) unique",
  "INSERT INTO messages (id, conversation_id, seq, role, content) VALUES (?,?,?,?,?)",
  [randomUUID(), convId, 1, "user", "dup"], undefined); // trigger or UNIQUE — either rejection is correct
rejects("messages: content is immutable (trigger)",
  "UPDATE messages SET content = 'edited' WHERE id = ?", [m0], "immutable");

// ── message_routing ────────────────────────────────────────────────────
rejects("routing: only assistant messages may have routing (trigger)",
  "INSERT INTO message_routing (message_id, created_at, routed_by, tier, difficulty, size, confidence, provider, model, model_label, input_tokens, output_tokens, estimated_input_tokens, estimated_output_tokens, max_tokens_out, latency_ms, cost_per_1k_tokens, finish_reason, context_window, context_utilization) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  [m0, now(), "complexity-analysis", "simple", 5, 5, 1, "groq", "m", "M", 1, 1, 1, 1, 1, 1, 0.001, "stop", 8000, 0.1], "assistant");

ok("routing: a valid assistant routing row is accepted", () => addRouting(m1));

rejects("routing: message_id is 1:1 (PK)",
  "INSERT INTO message_routing (message_id, created_at, routed_by, tier, difficulty, size, confidence, provider, model, model_label, input_tokens, output_tokens, estimated_input_tokens, estimated_output_tokens, max_tokens_out, latency_ms, cost_per_1k_tokens, finish_reason, context_window, context_utilization) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  [m1, now(), "complexity-analysis", "simple", 5, 5, 1, "groq", "m", "M", 1, 1, 1, 1, 1, 1, 0.001, "stop", 8000, 0.1], "UNIQUE");

const m2 = addMessage("user", "Postgres 12 to 16.", 2);
const m3 = addMessage("assistant", "Here is a plan.", 3);
ok("routing: difficulty must be 0..100", () => {
  let threw = false; try { addRouting(m3, { difficulty: 150 }); } catch { threw = true; }
  if (!threw) throw new Error("accepted difficulty 150");
});
ok("routing: tier must be simple|moderate|complex", () => {
  let threw = false; try { addRouting(m3, { tier: "extreme" }); } catch { threw = true; }
  if (!threw) throw new Error("accepted tier extreme");
});
ok("routing: reasons_json must be valid JSON", () => {
  let threw = false; try { addRouting(m3, { reasons_json: "[not json" }); } catch { threw = true; }
  if (!threw) throw new Error("accepted invalid JSON");
});
ok("routing: real reply must carry token counts (used_fallback=0 → tokens NOT NULL)", () => {
  let threw = false; try { addRouting(m3, { input_tokens: null, output_tokens: null }); } catch { threw = true; }
  if (!threw) throw new Error("accepted a non-fallback row with NULL tokens");
});
ok("routing: fallback reply may have NULL tokens", () => {
  addRouting(m3, { used_fallback: 1, input_tokens: null, output_tokens: null, finish_reason: "other", fallback_reason: "Groq API error (413)" });
});
ok("routing: trimmed_strategy and trimmed_dropped_messages travel together", () => {
  const m = addMessage("assistant", "x", 4);
  let threw = false; try { addRouting(m, { trimmed_strategy: "summarized", trimmed_dropped_messages: null }); } catch { threw = true; }
  if (!threw) throw new Error("accepted strategy without a count");
  addRouting(m, { trimmed_strategy: "summarized", trimmed_dropped_messages: 4 });
});

// ── triggers: bookkeeping ──────────────────────────────────────────────
ok("trigger: conversation counters are maintained", () => {
  const c = db.prepare("SELECT message_count, total_input_tokens, total_output_tokens, estimated_cost_usd, last_message_at FROM conversations WHERE id = ?").get(convId);
  if (c.message_count !== 5) throw new Error(`message_count = ${c.message_count}, expected 5`);
  if (c.total_input_tokens !== 144) throw new Error(`total_input_tokens = ${c.total_input_tokens}, expected 144 (two real replies × 72; the fallback adds 0)`);
  if (c.total_output_tokens !== 86) throw new Error(`total_output_tokens = ${c.total_output_tokens}`);
  if (!(c.estimated_cost_usd > 0)) throw new Error("cost not accumulated");
  if (!c.last_message_at) throw new Error("last_message_at not set");
});

ok("trigger: cannot append to a soft-deleted conversation", () => {
  db.prepare("UPDATE conversations SET deleted_at = ? WHERE id = ?").run(now(), convId);
  let threw = false; try { addMessage("user", "more", 5); } catch (e) { threw = /deleted/.test(e.message); }
  db.prepare("UPDATE conversations SET deleted_at = NULL WHERE id = ?").run(convId);
  if (!threw) throw new Error("append to deleted conversation was accepted");
});

ok("fts: full-text search finds a message and ranks it", () => {
  const rows = db.prepare(
    "SELECT m.id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH ? ORDER BY rank",
  ).all("postgres");
  if (rows.length !== 1 || rows[0].id !== m2) throw new Error(`expected 1 hit for 'postgres', got ${rows.length}`);
});

ok("view: v_usage_by_tier reports real per-tier tokens", () => {
  const r = db.prepare("SELECT * FROM v_usage_by_tier WHERE tier = 'simple'").get();
  if (!r || r.requests !== 3) throw new Error(`requests = ${r && r.requests}, expected 3`);
  if (r.fallbacks !== 1) throw new Error(`fallbacks = ${r.fallbacks}, expected 1`);
  if (r.input_tokens !== 144) throw new Error(`input_tokens = ${r.input_tokens}, expected 144`);
});

ok("cascade: deleting a user removes keys, conversations, messages, routing", () => {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  for (const t of ["forge_keys", "conversations", "messages", "message_routing"]) {
    const n = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    if (n !== 0) throw new Error(`${t} still has ${n} rows`);
  }
  const fts = db.prepare("SELECT COUNT(*) c FROM messages_fts WHERE messages_fts MATCH 'postgres'").get().c;
  if (fts !== 0) throw new Error("fts index still has rows");
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed) process.exit(1);
