/**
 * keyStore.js
 *
 * Manages API Forge's own developer-facing API keys — the "one key, many
 * models" credential a developer gets from YOUR platform and puts in their
 * app, same idea as an OpenRouter key.
 *
 * Storage: a simple JSON file (data/forgeKeys.json). No DB setup needed —
 * fine for a demo/prototype. Swap this module for a real DB-backed one
 * later without touching server.js, since it's the only place that reads
 * or writes key data.
 *
 * A forge key never contains or reveals any of the real upstream provider
 * keys (Anthropic/Groq/Mistral/Gemini) — those live only in providerKeys.js
 * on the server, loaded from environment variables.
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
 * Creates a new developer key. Returns the FULL raw key — this is the only
 * time it's returned in full; store it on the client side.
 */
function generateKey(name) {
  const store = readStore();
  const rawKey = "forge_" + crypto.randomBytes(24).toString("hex");
  const record = {
    id: crypto.randomUUID(),
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
 * Lists keys with the raw key MASKED (e.g. "forge_ab12...wx9z") so this is
 * safe to expose via a "my keys" dashboard endpoint.
 */
function listKeys() {
  const store = readStore();
  return store.keys.map(k => ({
    id: k.id,
    name: k.name,
    maskedKey: `${k.key.slice(0, 10)}...${k.key.slice(-4)}`,
    createdAt: k.createdAt,
    revoked: k.revoked,
    usage: k.usage,
  }));
}

function revokeKey(id) {
  const store = readStore();
  const record = store.keys.find(k => k.id === id);
  if (!record) return false;
  record.revoked = true;
  writeStore(store);
  return true;
}

module.exports = { generateKey, validateKey, recordUsage, listKeys, revokeKey };
