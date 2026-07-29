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
 * Same shape as every other provider: call(model, messages, apiKey) -> { text, usage }.
 */

async function call(model, messages, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
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
