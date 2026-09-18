/**
 * contextConfig.js
 *
 * Every tunable number used by contextManager.js. See D5 / D6 in
 * docs/task-context-window.md for the reasoning behind each.
 *
 * Env overrides:
 *   GATEWAY_MAX_OUTPUT_TOKENS=8192   hard ceiling on any answer
 *   CONTEXT_SUMMARIZE=off            disable summarising dropped turns
 */

function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  // Our token estimate is chars/4; real tokenizers differ per provider by
  // 10-15% either way. Pad the INPUT estimate by this much before deciding
  // whether a request fits.
  safetyMargin: 0.15,

  // If the room left for the answer would be below this, the model is
  // treated as NOT fitting. An answer with no room to exist is not a fit.
  minOutputFloor: 256,

  // Upper bound on max_tokens regardless of what the model allows. Callers
  // can send a lower `max_tokens`; they cannot exceed this.
  gatewayMaxOutputTokens: envInt("GATEWAY_MAX_OUTPUT_TOKENS", 8192),

  trim: {
    // The first user message usually holds the actual task ("you are a
    // Python tutor", "here is my schema"). Keep it whenever it fits.
    keepFirstUserMessage: true,
  },

  summarize: {
    // When trimming drops turns, summarise them with the cheap tier and
    // inject the summary as a system message instead of losing them.
    enabled: process.env.CONTEXT_SUMMARIZE !== "off",
    // Do not spend an upstream call to summarise a handful of tokens.
    minDroppedTokens: 200,
    // Cap on the summary itself.
    maxSummaryTokens: 400,
    // Which tier's model does the summarising. "simple" = cheapest.
    tier: "simple",
    // Hard cap on how much of the dropped text we send to the summariser.
    // Beyond this we take the head and tail — enough for a summary.
    maxInputTokens: 24000,
  },
};
