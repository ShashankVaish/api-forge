/**
 * routingLogger.js
 *
 * Appends one JSON line per routing decision. Without this there is no way
 * to tell whether the complexity heuristics are actually working — you can
 * only guess. Every later improvement (tuning the weights, cascade routing,
 * training a classifier) needs this data to exist first.
 *
 * PRIVACY: the prompt text is NEVER written. Only a SHA-256 hash, so you can
 * tell repeat prompts apart without storing what anyone asked. Same reasoning
 * as keyStore masking keys.
 *
 * Fails OPEN: logging is an optimisation, not a dependency. If the write
 * fails, the request still succeeds.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const LOG_FILE = path.join(DATA_DIR, "routing-log.jsonl");

const ENABLED = process.env.ROUTING_LOG !== "off";

function hashPrompt(text) {
  return crypto
    .createHash("sha256")
    .update(String(text || ""))
    .digest("hex")
    .slice(0, 16);
}

/**
 * @param {object} entry
 * @param {string} entry.promptText  hashed before writing, never stored raw
 * @param {object} entry.routing     the routing object returned to the caller
 * @param {object} entry.usage       { input_tokens, output_tokens }
 */
function logDecision({ promptText, routing, usage }) {
  if (!ENABLED) return;

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      promptHash: hashPrompt(promptText),
      routedBy: routing.routedBy,
      tier: routing.tier,
      difficulty: routing.difficulty,
      size: routing.size,
      confidence: routing.confidence,
      provider: routing.provider,
      model: routing.model,
      latencyMs: routing.latencyMs,
      estimatedInputTokens: routing.estimatedInputTokens,
      estimatedOutputTokens: routing.estimatedOutputTokens,
      actualInputTokens: usage?.input_tokens ?? null,
      actualOutputTokens: usage?.output_tokens ?? null,
      usedFallback: routing.usedFallback,
    });

    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (err) {
    console.warn("[routingLogger] could not write decision log:", err.message);
  }
}

module.exports = { logDecision };
