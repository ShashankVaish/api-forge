/**
 * server.js
 *
 * API Forge — an OpenRouter-style gateway. Developers get ONE Forge API
 * key from this platform (via POST /v1/keys) and use it in their app, the
 * same way they'd use an OpenRouter key. API Forge internally decides
 * which real model/provider to call (based on prompt complexity) and
 * internally holds the real upstream provider keys (Anthropic/Groq/
 * Mistral/Gemini) — the developer never sees or supplies those.
 *
 * Endpoints:
 *   POST   /v1/keys                 -> generate a new developer (Forge) key
 *   GET    /v1/keys                 -> list keys (masked) + usage
 *   DELETE /v1/keys/:id             -> revoke a key
 *   POST   /v1/chat/completions     -> main gateway endpoint (needs a Forge key)
 *   GET    /v1/stats                -> aggregate usage + estimated savings
 *   GET    /health                  -> liveness check
 */

const express = require("express");
const { routeRequest } = require("./src/modelRouter");
const usageTracker = require("./src/usageTracker");
const keyStore = require("./src/keystore/keyStore");

const app = express();
app.use(express.json({ limit: "2mb" }));

// CORS so a frontend can call this straight from the browser.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "api-forge" });
});

/**
 * Generate a new developer-facing Forge key. In a real product this would
 * sit behind your own login/auth — for this project it's open so you can
 * generate and demo keys freely.
 *
 * Body: { "name": "my app" }
 * Returns the FULL raw key ONCE — store it, it won't be shown again.
 */
app.post("/v1/keys", (req, res) => {
  const { name } = req.body || {};
  const record = keyStore.generateKey(name);
  res.json({
    message: "Store this key now — it will not be shown in full again.",
    id: record.id,
    name: record.name,
    key: record.key,
    createdAt: record.createdAt,
  });
});

/** List all keys (masked) with their usage so far. */
app.get("/v1/keys", (_req, res) => {
  res.json({ keys: keyStore.listKeys() });
});

/** Revoke a key by its id (from the list above). */
app.delete("/v1/keys/:id", (req, res) => {
  const ok = keyStore.revokeKey(req.params.id);
  if (!ok) return res.status(404).json({ error: "Key not found" });
  res.json({ revoked: true });
});

/**
 * Main gateway endpoint. Body shape mirrors OpenAI's chat completions:
 * {
 *   "model": "auto" | "haiku" | "sonnet" | "opus" | "groq-fast" | "groq-strong"
 *           | "gemini-flash" | "gemini-pro" | "mistral-small" | "mistral-large",
 *   "messages": [{ "role": "user", "content": "..." }]
 * }
 *
 * Auth: `Authorization: Bearer <forge_key>` — the developer's OWN Forge
 * key (from POST /v1/keys above), same pattern as OpenRouter/OpenAI.
 * API Forge resolves the real upstream provider key internally.
 */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const authHeader = req.header("Authorization") || "";
    const forgeKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!forgeKey) {
      return res.status(401).json({
        error: "Missing Authorization: Bearer <forge_key> header. Generate one via POST /v1/keys.",
      });
    }

    const keyRecord = keyStore.validateKey(forgeKey);
    if (!keyRecord) {
      return res.status(401).json({ error: "Invalid or revoked API Forge key" });
    }

    const { model = "auto", messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "`messages` array is required" });
    }

    const result = await routeRequest({ messages, requestedModel: model });

    usageTracker.record({ tier: result.routing.tier, usage: result.usage });
    keyStore.recordUsage(forgeKey, {
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
    });

    res.json({
      id: `forge_${Date.now()}`,
      model: result.routing.model,
      routing: result.routing,   // which tier/model/provider was actually used, and why
      choices: [
        { message: { role: "assistant", content: result.text } },
      ],
      usage: result.usage,
    });
  } catch (err) {
    console.error("Error in /v1/chat/completions:", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get("/v1/stats", (_req, res) => {
  res.json(usageTracker.getStats());
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API Forge running on http://localhost:${PORT}`);
  console.log("");
  console.log("1) Generate a developer key:");
  console.log(`   curl.exe -X POST "http://localhost:${PORT}/v1/keys" -H "Content-Type: application/json" -d "{\\"name\\":\\"my app\\"}"`);
  console.log("");
  console.log("2) Use it exactly like an OpenRouter key:");
  console.log(`   curl.exe -X POST "http://localhost:${PORT}/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_FORGE_KEY" -d "{\\"model\\":\\"auto\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"hi\\"}]}"`);
});
