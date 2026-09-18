/**
 * models.js
 *
 * Every model API Forge can route to, with the limits the context manager
 * needs to decide whether a request FITS before sending it.
 *
 * contextWindow / maxOutputTokens — verified against provider docs on
 * 2026-09-16 (see docs/task-context-window.md). Rule: when unsure,
 * UNDER-estimate. A window set too low only causes extra trimming; a window
 * set too high causes a failed call. Anthropic in particular returns a hard
 * 400 if max_tokens exceeds the model's real cap, so those are set low.
 */

const TIER_CONFIG = {
  simple: {
    provider: "groq",
    model: "openai/gpt-oss-20b",
    label: "Groq GPT-OSS 20B (fast)",
    approxCostPer1kTokens: 0.000375,
    contextWindow: 131072,
    maxOutputTokens: 65536,
    supportsPromptCaching: false,
  },

  moderate: {
    provider: "mistral",
    model: "mistral-small-latest",
    label: "Mistral Small (balanced)",
    approxCostPer1kTokens: 0.0005,
    // "latest" currently resolves to Small 4 (256k), but the alias moves.
    // 128k is safe for every version it has pointed at.
    contextWindow: 128000,
    maxOutputTokens: 32768,
    supportsPromptCaching: false,
  },

  complex: {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "Groq GPT-OSS 120B (strong)",
    approxCostPer1kTokens: 0.00075,
    contextWindow: 131072,
    maxOutputTokens: 65536,
    supportsPromptCaching: false,
  },

  haiku: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    label: "Haiku (fast/cheap)",
    approxCostPer1kTokens: 0.001,
    contextWindow: 200000,
    maxOutputTokens: 32000, // conservative — verify before raising
    supportsPromptCaching: true,
  },

  sonnet: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    label: "Sonnet (balanced)",
    approxCostPer1kTokens: 0.003,
    contextWindow: 200000,
    maxOutputTokens: 32000, // conservative — verify before raising
    supportsPromptCaching: true,
  },

  opus: {
    provider: "anthropic",
    model: "claude-opus-4-8",
    label: "Opus (max capability)",
    approxCostPer1kTokens: 0.015,
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsPromptCaching: true,
  },

  geminiFlash: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    label: "Gemini Flash (fast/cheap)",
    approxCostPer1kTokens: 0.0007,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsPromptCaching: true,
  },

  geminiPro: {
    provider: "gemini",
    model: "gemini-2.5-pro",
    label: "Gemini Pro (balanced/strong)",
    approxCostPer1kTokens: 0.005,
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsPromptCaching: true,
  },

  groqFast: {
    provider: "groq",
    model: "openai/gpt-oss-20b",
    label: "Groq GPT-OSS 20B",
    approxCostPer1kTokens: 0.000375,
    contextWindow: 131072,
    maxOutputTokens: 65536,
    supportsPromptCaching: false,
  },

  groqStrong: {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "Groq GPT-OSS 120B",
    approxCostPer1kTokens: 0.00075,
    contextWindow: 131072,
    maxOutputTokens: 65536,
    supportsPromptCaching: false,
  },

  mistralSmall: {
    provider: "mistral",
    model: "mistral-small-latest",
    label: "Mistral Small",
    approxCostPer1kTokens: 0.0005,
    contextWindow: 128000,
    maxOutputTokens: 32768,
    supportsPromptCaching: false,
  },

  mistralLarge: {
    provider: "mistral",
    model: "mistral-large-latest",
    label: "Mistral Large",
    approxCostPer1kTokens: 0.004,
    contextWindow: 128000,
    maxOutputTokens: 32768,
    supportsPromptCaching: false,
  },
};

/**
 * Per-request caps BELOW the model's context window, set per provider.
 *
 * Found the hard way: Groq's free tier rejects any single request over
 * 8,000 tokens (input + max_tokens) with a 413, even though the model's
 * window is 131k. The context manager uses
 *   effective window = min(contextWindow, maxRequestTokens)
 * so trimming targets the limit that will actually be enforced.
 *
 *   GROQ_MAX_REQUEST_TOKENS=8000       (free tier; raise on a paid plan)
 *   MISTRAL_MAX_REQUEST_TOKENS=...
 *   ANTHROPIC_MAX_REQUEST_TOKENS=...
 *   GEMINI_MAX_REQUEST_TOKENS=...
 * Unset = no cap beyond the model's own window.
 */
function envInt(name) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const PER_REQUEST_CAPS = {
  groq: envInt("GROQ_MAX_REQUEST_TOKENS"),
  mistral: envInt("MISTRAL_MAX_REQUEST_TOKENS"),
  anthropic: envInt("ANTHROPIC_MAX_REQUEST_TOKENS"),
  gemini: envInt("GEMINI_MAX_REQUEST_TOKENS"),
};

// Give every entry a stable `key` so the context manager can report which
// config it picked without callers having to reverse-lookup the object,
// and attach the provider's per-request cap (null = none).
for (const [key, cfg] of Object.entries(TIER_CONFIG)) {
  cfg.key = key;
  cfg.maxRequestTokens = PER_REQUEST_CAPS[cfg.provider] ?? null;
}

const EXPLICIT_MODEL_ALIASES = {
  haiku: TIER_CONFIG.haiku,
  sonnet: TIER_CONFIG.sonnet,
  opus: TIER_CONFIG.opus,
  "gemini-flash": TIER_CONFIG.geminiFlash,
  "gemini-pro": TIER_CONFIG.geminiPro,
  "groq-fast": TIER_CONFIG.groqFast,
  "groq-strong": TIER_CONFIG.groqStrong,
  "mistral-small": TIER_CONFIG.mistralSmall,
  "mistral-large": TIER_CONFIG.mistralLarge,
};

/**
 * Ordered candidates per tier: cheapest first, biggest window last.
 * The router walks each ladder and takes the first model that has a
 * provider key configured AND fits the request. Step 1 is always the
 * tier's default, so behaviour is unchanged whenever the request fits.
 */
const TIER_LADDER = {
  simple: ["simple", "geminiFlash"],
  moderate: ["moderate", "geminiFlash"],
  complex: ["complex", "geminiPro"],
};

function getConfigForTier(tier) {
  return TIER_CONFIG[tier] || TIER_CONFIG.moderate;
}

function getLadderForTier(tier) {
  const keys = TIER_LADDER[tier] || TIER_LADDER.moderate;
  return keys.map((k) => TIER_CONFIG[k]);
}

function getConfigForExplicitModel(modelName) {
  return EXPLICIT_MODEL_ALIASES[modelName.toLowerCase()] || null;
}

module.exports = {
  TIER_CONFIG,
  TIER_LADDER,
  getConfigForTier,
  getLadderForTier,
  getConfigForExplicitModel,
};
