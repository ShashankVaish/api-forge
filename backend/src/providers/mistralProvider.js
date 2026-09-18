/**
 * mistralProvider.js
 *
 * Adapter for Mistral's "La Plateforme" API. OpenAI-compatible request/
 * response shape, standard `Authorization: Bearer <key>` auth — no key
 * format ambiguity, unlike the current Gemini situation.
 *
 * Get a free key at https://console.mistral.ai/api-keys
 *
 * Same shape as every other provider:
 *   call(model, messages, apiKey, options) -> { text, usage, finishReason }
 */

const { normalizeOpenAIFinish, providerError } = require("./shared");

async function call(model, messages, apiKey, options = {}) {
  const body = { model, messages };
  if (options.maxOutputTokens) body.max_tokens = options.maxOutputTokens;

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await providerError("Mistral", response);
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
