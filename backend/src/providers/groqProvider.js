/**
 * groqProvider.js
 *
 * Adapter for Groq's API — chosen as a second REAL (non-mock) provider
 * alongside Anthropic, since Groq's endpoint is OpenAI-compatible and uses
 * standard `Authorization: Bearer <key>` auth (no key-format migrations,
 * no OAuth-vs-API-key ambiguity like the current Gemini situation).
 *
 * Get a free key at https://console.groq.com/keys
 *
 * Same shape as every other provider:
 *   call(model, messages, apiKey, options) -> { text, usage, finishReason }
 *
 * options.maxOutputTokens — ceiling on the answer, decided by the context
 * manager so it always fits the window. finishReason is normalised to
 * "stop" | "length" | "other" so the router can flag truncated answers.
 */

const { normalizeOpenAIFinish, providerError } = require("./shared");

async function call(model, messages, apiKey, options = {}) {
  const body = { model, messages };
  if (options.maxOutputTokens) body.max_tokens = options.maxOutputTokens;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await providerError("Groq", response);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  return {
    text: choice?.message?.content || "",
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? null,
      output_tokens: data.usage?.completion_tokens ?? null,
    },
    finishReason: normalizeOpenAIFinish(choice?.finish_reason),
  };
}

module.exports = { call };
