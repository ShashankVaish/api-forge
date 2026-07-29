/**
 * models.js
 *
 * Single source of truth mapping a complexity tier -> which provider + model
 * to call, and a rough $ per 1K tokens (for the cost-savings estimate shown
 * in /stats). Adding a new provider/model later = add one entry here, plus
 * an adapter in src/providers/.
 */

const TIER_CONFIG = {
  simple: {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    label: "Groq Llama 3.1 8B (fast/cheap)",
    approxCostPer1kTokens: 0.0002,
  },
  moderate: {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Groq Llama 3.3 70B (balanced)",
    approxCostPer1kTokens: 0.001,
  },
  complex: {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Groq Llama 3.3 70B (max capability, free tier)",
    approxCostPer1kTokens: 0.001,
  },
  // Anthropic tiers kept available for explicit use once credits exist —
  // just not used as the "auto" default anymore, since Anthropic requires
  // a paid/funded account (no meaningful free tier).
  haiku: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    label: "Haiku (fast/cheap)",
    approxCostPer1kTokens: 0.001,
  },
  sonnet: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    label: "Sonnet (balanced)",
    approxCostPer1kTokens: 0.003,
  },
  opus: {
    provider: "anthropic",
    model: "claude-opus-4-8",
    label: "Opus (max capability)",
    approxCostPer1kTokens: 0.015,
  },
  geminiFlash: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    label: "Gemini Flash (fast/cheap)",
    approxCostPer1kTokens: 0.0007,
  },
  geminiPro: {
    provider: "gemini",
    model: "gemini-2.5-pro",
    label: "Gemini Pro (balanced/strong)",
    approxCostPer1kTokens: 0.005,
  },
  groqFast: {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    label: "Groq Llama 3.1 8B (ultra-fast/cheap)",
    approxCostPer1kTokens: 0.0002,
  },
  groqStrong: {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Groq Llama 3.3 70B (strong/fast)",
    approxCostPer1kTokens: 0.001,
  },
  mistralSmall: {
    provider: "mistral",
    model: "mistral-small-latest",
    label: "Mistral Small (free tier)",
    approxCostPer1kTokens: 0.0005,
  },
  mistralLarge: {
    provider: "mistral",
    model: "mistral-large-latest",
    label: "Mistral Large (strong)",
    approxCostPer1kTokens: 0.004,
  },
};

// If a user explicitly asks for a specific model instead of "auto",
// we still route it through the right provider adapter.
const EXPLICIT_MODEL_ALIASES = {
  "haiku": TIER_CONFIG.haiku,
  "sonnet": TIER_CONFIG.sonnet,
  "opus": TIER_CONFIG.opus,
  "gemini-flash": TIER_CONFIG.geminiFlash,
  "gemini-pro": TIER_CONFIG.geminiPro,
  "groq-fast": TIER_CONFIG.groqFast,
  "groq-strong": TIER_CONFIG.groqStrong,
  "mistral-small": TIER_CONFIG.mistralSmall,
  "mistral-large": TIER_CONFIG.mistralLarge,
};

function getConfigForTier(tier) {
  return TIER_CONFIG[tier] || TIER_CONFIG.moderate;
}

function getConfigForExplicitModel(modelName) {
  return EXPLICIT_MODEL_ALIASES[modelName.toLowerCase()] || null;
}

module.exports = { TIER_CONFIG, getConfigForTier, getConfigForExplicitModel };
