/**
 * keyStore.js
 *
 * Manages API Forge's own developer-facing API keys — the "one key, many
 * models" credential a developer gets from YOUR platform and puts in their
 * app, same idea as an OpenRouter key.
 *
 * Every key is scoped to the logged-in developer (userId) who created it —
 * generateKey/listKeys/revokeKey all take a userId so one developer can
 * never see or revoke another developer's keys.
 *
 * validateKey() is the exception — it's called from the main gateway
 * (/v1/chat/completions), which authenticates via the raw Forge key itself
 * (no browser session there), so it doesn't need a userId.
 *
 * Storage: a simple JSON file (data/forgeKeys.json). No DB setup needed —
 * fine for a demo/prototype. Swap this module for a real DB-backed one
 * later without touching server.js, since it's the only place that reads
 * or writes key data.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "forgeKeys.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ keys: [] }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

/**
 * Creates a new developer key, owned by `userId`. Returns the FULL raw
 * key — this is the only time it's returned in full; the client must
 * store it, since we only ever show it masked after this.
 */
function generateKey(name, userId) {
  const store = readStore();
  const rawKey = "forge_" + crypto.randomBytes(24).toString("hex");
  const record = {
    id: crypto.randomUUID(),
    userId,
    name: name && name.trim() ? name.trim() : "Unnamed key",
    key: rawKey,
    createdAt: new Date().toISOString(),
    revoked: false,
    usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
  };
  store.keys.push(record);
  writeStore(store);
  return record;
}

/**
 * Returns the key record if valid and not revoked, else null.
 * No userId check here — this is what the /v1/chat/completions gateway
 * calls, and it authenticates purely via the raw key value itself.
 */
function validateKey(rawKey) {
  if (!rawKey) return null;
  const store = readStore();
  return store.keys.find(k => k.key === rawKey && !k.revoked) || null;
}

function recordUsage(rawKey, { inputTokens, outputTokens }) {
  const store = readStore();
  const record = store.keys.find(k => k.key === rawKey);
  if (!record) return;
  record.usage.requests += 1;
  record.usage.inputTokens += inputTokens || 0;
  record.usage.outputTokens += outputTokens || 0;
  writeStore(store);
}

/**
 * Lists only the keys owned by `userId`, with the raw key MASKED
 * (e.g. "forge_ab12...wx9z") so this is safe to expose via a dashboard.
 */
function listKeys(userId) {
  const store = readStore();
  return store.keys
    .filter(k => k.userId === userId)
    .map(k => ({
      id: k.id,
      name: k.name,
      maskedKey: `${k.key.slice(0, 10)}...${k.key.slice(-4)}`,
      createdAt: k.createdAt,
      revoked: k.revoked,
      usage: k.usage,
    }));
}

/**
 * Revokes a key by id, but ONLY if it's owned by `userId`. Returns false
 * if the key doesn't exist or belongs to someone else (same response
 * either way, so we don't leak whether a given id exists for another user).
 */
function revokeKey(id, userId) {
  const store = readStore();
  const record = store.keys.find(k => k.id === id && k.userId === userId);
  if (!record) return false;
  record.revoked = true;
  writeStore(store);
  return true;
}

module.exports = { generateKey, validateKey, recordUsage, listKeys, revokeKey };
