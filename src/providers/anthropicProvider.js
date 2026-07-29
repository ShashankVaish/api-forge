/**
 * anthropicProvider.js
 *
 * Thin adapter around Anthropic's /v1/messages endpoint.
 * The point of having this as a separate "provider" file (instead of just
 * calling fetch directly from server.js) is that API Forge's whole pitch is
 * "one key, many models/providers" — so every provider must expose the same
 * shape: call(model, messages, apiKey) -> { text, usage }.
 * Adding OpenAI/Gemini/etc later = add openaiProvider.js with this same shape.
 */

async function call(model, messages, apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n");

  return {
    text,
    usage: {
      input_tokens: data.usage?.input_tokens ?? null,
      output_tokens: data.usage?.output_tokens ?? null,
    },
  };
}

module.exports = { call };
