/**
 * geminiProvider.js
 *
 * Adapter for Google's Gemini API. Same shape as every other provider:
 *   call(model, messages, apiKey, options) -> { text, usage, finishReason }
 *
 * Gemini's REST API expects "contents" with role "user"/"model" (not
 * "assistant"), so we translate our internal OpenAI-style message format
 * into Gemini's shape before sending. The output ceiling goes in
 * generationConfig.maxOutputTokens, and finishReason "MAX_TOKENS" is the
 * truncation signal.
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

const { providerError } = require("./shared");

function toGeminiContents(messages) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

function normalizeGeminiFinish(reason) {
  if (reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  return "other";
}

async function call(model, messages, apiKey, options = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);

  const body = {
    contents: toGeminiContents(messages),
    ...(systemParts.length
      ? { systemInstruction: { parts: [{ text: systemParts.join("\n\n") }] } }
      : {}),
    ...(options.maxOutputTokens
      ? { generationConfig: { maxOutputTokens: options.maxOutputTokens } }
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
    throw await providerError("Gemini", response);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || "")
    .join("\n");

  return {
    text,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? null,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
    },
    finishReason: normalizeGeminiFinish(candidate?.finishReason),
  };
}

module.exports = { call };
