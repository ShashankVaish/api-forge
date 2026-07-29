/**
 * openaiProvider.js
 *
 * This is a MOCK adapter (no real OpenAI key wired up). It exists purely to
 * prove the architecture: API Forge is provider-agnostic. Any adapter just
 * needs to expose call(model, messages, apiKey) -> { text, usage }.
 * In a real deployment you'd swap this stub for an actual fetch() to
 * https://api.openai.com/v1/chat/completions.
 */

async function call(model, messages, _apiKey) {
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  return {
    text: `[MOCK OpenAI response via ${model}] This is a stub — wire in a real OpenAI key to make this live. You said: "${(lastUserMessage?.content || "").slice(0, 120)}"`,
    usage: { input_tokens: null, output_tokens: null },
  };
}

module.exports = { call };
