/**
 * anthropicProvider.js
 *
 * Thin adapter around Anthropic's /v1/messages endpoint.
 * The point of having this as a separate "provider" file (instead of just
 * calling fetch directly from server.js) is that API Forge's whole pitch is
 * "one key, many models/providers" — so every provider must expose the same
 * shape:
 *   call(model, messages, apiKey, options) -> { text, usage, finishReason }
 *
 * Anthropic differences the router does not need to know about:
 *   - `max_tokens` is REQUIRED, so a fallback is always sent.
 *   - `system` is a top-level field, not a message role.
 *   - stop_reason "max_tokens" is the truncation signal.
 */

const { providerError } = require("./shared");

// Used only if the context manager did not supply a ceiling. Kept modest
// because Anthropic rejects max_tokens above the model's real cap.
const FALLBACK_MAX_TOKENS = 4096;

function normalizeAnthropicFinish(reason) {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop";
  if (reason === "max_tokens") return "length";
  return "other";
}

async function call(model, messages, apiKey, options = {}) {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const chatMessages = messages.filter((m) => m.role !== "system");

  const body = {
    model,
    max_tokens: options.maxOutputTokens || FALLBACK_MAX_TOKENS,
    messages: chatMessages,
  };
  if (systemParts.length) body.system = systemParts.join("\n\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await providerError("Anthropic", response);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return {
    text,
    usage: {
      input_tokens: data.usage?.input_tokens ?? null,
      output_tokens: data.usage?.output_tokens ?? null,
    },
    finishReason: normalizeAnthropicFinish(data.stop_reason),
  };
}

module.exports = { call };
