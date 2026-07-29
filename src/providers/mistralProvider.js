/**
 * mistralProvider.js
 *
 * Adapter for Mistral's "La Plateforme" API. OpenAI-compatible request/
 * response shape, standard `Authorization: Bearer <key>` auth — no key
 * format ambiguity, unlike the current Gemini situation.
 *
 * Get a free key at https://console.mistral.ai/api-keys
 *
 * Same shape as every other provider: call(model, messages, apiKey) -> { text, usage }.
 */

async function call(model, messages, apiKey) {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mistral API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";

  return {
    text,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? null,
      output_tokens: data.usage?.completion_tokens ?? null,
    },
  };
}

module.exports = { call };
