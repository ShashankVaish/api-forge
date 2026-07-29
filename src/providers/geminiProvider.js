/**
 * geminiProvider.js
 *
 * Adapter for Google's Gemini API. Same shape as every other provider:
 * call(model, messages, apiKey) -> { text, usage }.
 *
 * Gemini's REST API expects "contents" with role "user"/"model" (not
 * "assistant"), so we translate our internal OpenAI-style message format
 * into Gemini's shape before sending.
 *
 * Auth note (important, as of 2026): Google is migrating Gemini API keys
 * from the legacy "Standard key" format (starts "AIzaSy...") to a new
 * "Auth key" format (starts "AQ.Ab..."). Both formats should be sent the
 * same way: as the `x-goog-api-key` request header — NOT as a `?key=`
 * query param and NOT as `Authorization: Bearer` (that's for actual OAuth
 * access tokens, which is a different credential type entirely and will
 * fail with ACCESS_TOKEN_TYPE_UNSUPPORTED if you pass an API key there).
 * If requests still fail with a valid key, it may be a rollout-side issue
 * on Google's end with the newer Auth key format — check
 * https://discuss.ai.google.dev for current status.
 */

function toGeminiContents(messages) {
  return messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

async function call(model, messages, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const systemMessage = messages.find(m => m.role === "system");

  const body = {
    contents: toGeminiContents(messages),
    ...(systemMessage
      ? { systemInstruction: { parts: [{ text: systemMessage.content }] } }
      : {}),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();

  const text = (data.candidates || [])
    .flatMap(c => c.content?.parts || [])
    .map(p => p.text || "")
    .join("\n");

  return {
    text,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? null,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

module.exports = { call };


