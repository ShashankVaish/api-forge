/**
 * redisCache.js
 *
 * Caches model responses so identical (or near-identical) requests don't
 * trigger a redundant upstream API call. This is the piece that backs the
 * resume claim "reducing redundant API calls."
 *
 * Design notes for the interview:
 * - Cache key = hash of (model + full messages array). Same conversation,
 *   same model -> same key -> cache hit.
 * - We do NOT cache across different `x-provider-api-key` values, to avoid
 *   one user's cached response leaking to another user's key/account.
 * - TTL is short (default 10 min) because model outputs for open-ended
 *   prompts shouldn't be treated as permanently "the answer."
 * - Fails OPEN: if Redis is down/unreachable, we log a warning and just
 *   skip caching rather than crashing the request. A cache is an
 *   optimization, not a hard dependency.
 */

const crypto = require("crypto");
const { createClient } = require("redis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DEFAULT_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 600);

let client = null;
let connectPromise = null;
let isAvailable = false;

async function getClient() {
  if (client) return client;
  if (!connectPromise) {
    client = createClient({ url: REDIS_URL });
    client.on("error", (err) => {
      isAvailable = false;
      console.warn("[redisCache] Redis error (caching disabled):", err.message);
    });
    connectPromise = client
      .connect()
      .then(() => {
        isAvailable = true;
        console.log("[redisCache] Connected to Redis at", REDIS_URL);
      })
      .catch((err) => {
        isAvailable = false;
        console.warn("[redisCache] Could not connect to Redis, running without cache:", err.message);
      });
  }
  await connectPromise;
  return client;
}

function buildCacheKey({ model, messages, apiKeyFingerprint }) {
  const raw = JSON.stringify({ model, messages, apiKeyFingerprint });
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return `api-forge:cache:${hash}`;
}

// Never store the real API key — just a short fingerprint so cache entries
// stay scoped per-key without persisting the secret itself.
function fingerprintKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey || "").digest("hex").slice(0, 12);
}

async function getCached({ model, messages, apiKey }) {
  try {
    const c = await getClient();
    if (!isAvailable) return null;
    const key = buildCacheKey({ model, messages, apiKeyFingerprint: fingerprintKey(apiKey) });
    const value = await c.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.warn("[redisCache] getCached failed, continuing without cache:", err.message);
    return null;
  }
}

async function setCached({ model, messages, apiKey }, payload, ttlSeconds = DEFAULT_TTL_SECONDS) {
  try {
    const c = await getClient();
    if (!isAvailable) return;
    const key = buildCacheKey({ model, messages, apiKeyFingerprint: fingerprintKey(apiKey) });
    await c.set(key, JSON.stringify(payload), { EX: ttlSeconds });
  } catch (err) {
    console.warn("[redisCache] setCached failed, continuing without cache:", err.message);
  }
}

module.exports = { getCached, setCached };
