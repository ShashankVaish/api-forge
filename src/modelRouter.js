/**
 * modelRouter.js
 *
 * Glue layer: takes the user's request, decides (via complexityAnalyzer)
 * which tier applies (unless a specific model was requested), picks the
 * right provider adapter, and calls it using API Forge's OWN upstream
 * provider key (from providerKeys.js) — not a key supplied by the caller.
 * This is the OpenRouter-style shift: developers authenticate with their
 * Forge key (validated in server.js), and never see or handle the real
 * upstream provider credentials.
 */

const { analyzeComplexity } = require("./complexityAnalyzer");
const { getConfigForTier, getConfigForExplicitModel } = require("./config/models");
const providerKeys = require("./config/providerKeys");

const providers = {
  anthropic: require("./providers/anthropicProvider"),
  openai: require("./providers/openaiProvider"),
  gemini: require("./providers/geminiProvider"),
  groq: require("./providers/groqProvider"),
  mistral: require("./providers/mistralProvider"),
};

/**
 * @param {object} params
 * @param {Array<{role:string, content:string}>} params.messages
 * @param {string} params.requestedModel - "auto" | "haiku" | "sonnet" | "opus" | "groq-fast" | ...
 */
async function routeRequest({ messages, requestedModel = "auto" }) {
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  const promptText = lastUserMessage ? lastUserMessage.content : "";

  const analysis = analyzeComplexity(promptText, {
    contextMessageCount: messages.length,
  });

  let config;
  let routedBy;

  if (requestedModel && requestedModel !== "auto") {
    const explicit = getConfigForExplicitModel(requestedModel);
    if (explicit) {
      config = explicit;
      routedBy = "explicit-request";
    }
  }

  if (!config) {
    config = getConfigForTier(analysis.tier);
    routedBy = "complexity-analysis";
  }

  const provider = providers[config.provider];
  if (!provider) {
    throw new Error(`No adapter registered for provider "${config.provider}"`);
  }

  const platformApiKey = providerKeys[config.provider];
  if (!platformApiKey) {
    throw new Error(
      `API Forge has no platform API key configured for provider "${config.provider}". ` +
      `Set the matching env var on the server (see .env.example).`
    );
  }

  const start = Date.now();
  let result;
  let usedFallback = false;
  let fallbackReason = null;

  try {
    result = await provider.call(config.model, messages, platformApiKey);
  } catch (err) {
    // Upstream provider outage / auth issue / rollout bug should never
    // crash the gateway. We degrade gracefully so the rest of the system
    // (routing, key auth, usage tracking) still demonstrates correctly.
    usedFallback = true;
    fallbackReason = err.message;
    console.warn(`[modelRouter] Provider "${config.provider}" call failed, using fallback:`, err.message);
    result = {
      text: `[FALLBACK RESPONSE — ${config.label} was unreachable]\n` +
        `The upstream provider call failed (${fallbackReason}). ` +
        `This fallback lets the routing/auth/usage-tracking pipeline keep working end-to-end for demo purposes.`,
      usage: { input_tokens: null, output_tokens: null },
    };
  }

  const latencyMs = Date.now() - start;

  return {
    text: result.text,
    usage: result.usage,
    routing: {
      routedBy,               // "complexity-analysis" or "explicit-request"
      tier: analysis.tier,
      complexityScore: analysis.score,
      reasons: analysis.reasons,
      provider: config.provider,
      model: config.model,
      modelLabel: config.label,
      estimatedCostPer1kTokens: config.approxCostPer1kTokens,
      latencyMs,
      usedFallback,
      fallbackReason,
    },
  };
}

module.exports = { routeRequest };
