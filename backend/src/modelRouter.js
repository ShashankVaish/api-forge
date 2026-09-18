/**
 * modelRouter.js
 *
 * Glue layer: takes the user's request, decides (via complexityAnalyzer)
 * which tier applies (unless a specific model was requested), makes sure
 * the request FITS the chosen model's context window (via contextManager),
 * picks the right provider adapter, and calls it using API Forge's OWN
 * upstream provider key (from providerKeys.js) — not a key supplied by the
 * caller. This is the OpenRouter-style shift: developers authenticate with
 * their Forge key (validated in server.js), and never see or handle the real
 * upstream provider credentials.
 *
 * Request lifecycle:
 *   1. analyze      -> tier, expected output size, conversation size
 *   2. candidates   -> the tier's ladder (auto) or one model (explicit)
 *   3. planContext  -> first model that fits; else largest, and trim
 *   4. summarise    -> dropped turns compressed by the cheap tier (optional)
 *   5. call         -> provider adapter with a max_tokens that fits
 *   6. retry        -> once, on a bigger model, if upstream says "too long"
 *   7. report       -> routing.context / routing.truncated to the caller
 */

const { analyzeComplexity } = require("./complexityAnalyzer");
const {
  getConfigForTier,
  getConfigForExplicitModel,
  getLadderForTier,
} = require("./config/models");
const C = require("./config/contextConfig");
const defaultProviderKeys = require("./config/providerKeys");
const contextManager = require("./contextManager");
const { logDecision } = require("./routingLogger");

const defaultProviders = {
  anthropic: require("./providers/anthropicProvider"),
  openai: require("./providers/openaiProvider"),
  gemini: require("./providers/geminiProvider"),
  groq: require("./providers/groqProvider"),
  mistral: require("./providers/mistralProvider"),
};

function getProvider(providers, config) {
  const provider = providers[config.provider];
  if (!provider) {
    throw new Error(`No adapter registered for provider "${config.provider}"`);
  }
  return provider;
}

/**
 * Compresses the turns that trimming dropped, using the cheap tier, and
 * injects the summary as a system message. Fail-OPEN: any problem here
 * (no key, upstream error, summary too big) just leaves the plain trim in
 * place — the user's request must never fail because of an optimisation.
 */
async function summarizeDropped(plan, analysis, deps) {
  const { droppedMessages } = plan;
  const droppedTokens = plan.context.trimmed?.droppedTokens || 0;

  if (!C.summarize.enabled) return plan;
  if (droppedMessages.length === 0 || droppedTokens < C.summarize.minDroppedTokens) return plan;

  const summarizer = getConfigForTier(C.summarize.tier);
  const key = deps.providerKeys[summarizer.provider];
  if (!key) return plan;

  try {
    const provider = getProvider(deps.providers, summarizer);

    // The summariser has its own window (and per-request cap). Size the
    // transcript so instructions + transcript + summary all fit inside it.
    const summarizerRoom =
      contextManager.effectiveWindow(summarizer) - C.summarize.maxSummaryTokens;
    const transcriptCap = Math.min(
      C.summarize.maxInputTokens,
      Math.floor(summarizerRoom / (1 + 0.15)) - 300, // margin + instruction overhead
    );
    if (transcriptCap < 400) return plan; // not enough room to summarise anything useful

    const result = await provider.call(
      summarizer.model,
      contextManager.buildSummaryRequest(droppedMessages, transcriptCap),
      key,
      { maxOutputTokens: C.summarize.maxSummaryTokens },
    );
    if (!result.text?.trim()) return plan;

    const { messages, summaryTokens } = contextManager.injectSummary(plan.messages, result.text.trim());

    // The summary must itself fit. If it does not, keep the plain trim.
    const inputTokens = plan.context.inputTokens + summaryTokens;
    const budget = contextManager.budgetFor(
      plan.model,
      inputTokens,
      analysis.signals.expectedOutputTokens,
      plan.requestedMaxTokens,
    );
    if (!budget.fits) return plan;

    return {
      ...plan,
      messages,
      maxTokensOut: budget.maxTokensOut,
      context: {
        ...plan.context,
        inputTokens,
        utilization: Number((budget.paddedInput / budget.window).toFixed(2)),
        trimmed: {
          ...plan.context.trimmed,
          strategy: "summarized",
          summaryTokens,
          summarizedBy: summarizer.model,
        },
      },
    };
  } catch (err) {
    console.warn("[modelRouter] summarisation failed, keeping plain trim:", err.message);
    return plan;
  }
}

/**
 * @param {object} params
 * @param {Array<{role:string, content:string}>} params.messages
 * @param {string} [params.requestedModel="auto"]
 * @param {number} [params.maxTokens]  `max_tokens` from the request body (D9)
 * @param {object} [deps]  { providers, providerKeys } — injectable for tests
 */
async function routeRequest(
  { messages, requestedModel = "auto", maxTokens = null },
  deps = { providers: defaultProviders, providerKeys: defaultProviderKeys },
) {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const promptText = lastUserMessage ? lastUserMessage.content : "";

  // The full `messages` array is passed through so the analyzer can measure
  // real conversation volume (6 one-word turns are not 6 long ones) and hold
  // a tier across follow-ups like "continue", which score 0 on their own.
  const analysis = analyzeComplexity(promptText, {
    contextMessageCount: messages.length,
    messages,
  });

  // ── candidates ───────────────────────────────────────────────────────
  let candidates;
  let routedBy;
  let allowModelSwitch;

  const explicit =
    requestedModel && requestedModel !== "auto"
      ? getConfigForExplicitModel(requestedModel)
      : null;

  if (explicit) {
    // D3: an explicit model is never silently switched — trim instead.
    candidates = [explicit];
    routedBy = "explicit-request";
    allowModelSwitch = false;
  } else {
    candidates = getLadderForTier(analysis.tier);
    routedBy = "complexity-analysis";
    allowModelSwitch = true;
  }

  const hasKey = (provider) => Boolean(deps.providerKeys[provider]);
  const requestedMaxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : null;

  const makePlan = (cands) =>
    contextManager.planContext({
      messages,
      candidates: cands,
      expectedOutputTokens: analysis.signals.expectedOutputTokens,
      requestedMaxTokens,
      allowModelSwitch,
      hasKey,
    });

  // ── plan + summarise ─────────────────────────────────────────────────
  let plan = makePlan(candidates);
  plan.requestedMaxTokens = requestedMaxTokens;
  plan = await summarizeDropped(plan, analysis, deps);

  // ── call, with one retry on a bigger model if upstream disagrees ─────
  const start = Date.now();
  let result;
  let usedFallback = false;
  let fallbackReason = null;
  let retriedOnContextError = false;

  const callModel = async (p) => {
    const provider = getProvider(deps.providers, p.model);
    const key = deps.providerKeys[p.model.provider];
    if (!key) {
      throw new Error(
        `API Forge has no platform API key configured for provider "${p.model.provider}". ` +
          "Set the matching env var on the server (see .env.example).",
      );
    }
    return provider.call(p.model.model, p.messages, key, { maxOutputTokens: p.maxTokensOut });
  };

  try {
    try {
      result = await callModel(plan);
    } catch (err) {
      // D7: our estimate said it fits, the provider says it does not. Try
      // the next larger candidate once before giving up.
      const idx = candidates.indexOf(plan.model);
      const larger = allowModelSwitch
        ? candidates
            .slice(idx + 1)
            .filter(
              (c) =>
                contextManager.effectiveWindow(c) > contextManager.effectiveWindow(plan.model) &&
                hasKey(c.provider),
            )
        : [];

      if (!contextManager.isContextLengthError(err) || larger.length === 0) throw err;

      console.warn(
        `[modelRouter] ${plan.model.label} rejected the prompt as too long; retrying on ${larger[0].label}`,
      );
      retriedOnContextError = true;
      plan = makePlan(larger);
      plan.requestedMaxTokens = requestedMaxTokens;
      plan = await summarizeDropped(plan, analysis, deps);
      result = await callModel(plan);
    }
  } catch (err) {
    // Upstream provider outage / auth issue / rollout bug should never
    // crash the gateway. We degrade gracefully so the rest of the system
    // (routing, key auth, usage tracking) still demonstrates correctly.
    usedFallback = true;
    fallbackReason = err.message;
    console.warn(`[modelRouter] Provider "${plan.model.provider}" call failed, using fallback:`, err.message);
    result = {
      text:
        `[FALLBACK RESPONSE — ${plan.model.label} was unreachable]\n` +
        `The upstream provider call failed (${fallbackReason}). ` +
        "This fallback lets the routing/auth/usage-tracking pipeline keep working end-to-end for demo purposes.",
      usage: { input_tokens: null, output_tokens: null },
      finishReason: "other",
    };
  }

  const latencyMs = Date.now() - start;
  const config = plan.model;

  const routing = {
    routedBy,               // "complexity-analysis" or "explicit-request"
    tier: analysis.tier,
    complexityScore: analysis.score,
    difficulty: analysis.difficulty,   // how much reasoning is needed
    size: analysis.size,               // how many tokens flow in and out
    confidence: analysis.confidence,   // 0-1, distance from a tier cutoff
    estimatedInputTokens: plan.context.inputTokens,
    estimatedOutputTokens: analysis.signals.expectedOutputTokens,
    reasons: analysis.reasons,
    provider: config.provider,
    model: config.model,
    modelLabel: config.label,
    estimatedCostPer1kTokens: config.approxCostPer1kTokens,
    latencyMs,
    usedFallback,
    fallbackReason,
    // D8: never hide a cut-off answer.
    truncated: result.finishReason === "length",
    finishReason: result.finishReason,
    maxTokensOut: plan.maxTokensOut,
    context: { ...plan.context, retriedOnContextError },
  };

  // Fire-and-forget: hashed, never the prompt text itself.
  logDecision({ promptText, routing, usage: result.usage });

  return {
    text: result.text,
    usage: result.usage,
    routing,
  };
}

module.exports = { routeRequest };
