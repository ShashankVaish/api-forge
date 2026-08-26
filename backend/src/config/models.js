const TIER_CONFIG = {
  simple: {
    provider: "groq",
    model: "openai/gpt-oss-20b",
    label: "Groq GPT-OSS 20B (fast)",
    approxCostPer1kTokens: 0.000375,
  },

  moderate: {
    provider: "mistral",
    model: "mistral-small-latest",
    label: "Mistral Small (balanced)",
    approxCostPer1kTokens: 0.0005,
  },

  complex: {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "Groq GPT-OSS 120B (strong)",
    approxCostPer1kTokens: 0.00075,
  },

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
    model: "openai/gpt-oss-20b",
    label: "Groq GPT-OSS 20B",
    approxCostPer1kTokens: 0.000375,
  },

  groqStrong: {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "Groq GPT-OSS 120B",
    approxCostPer1kTokens: 0.00075,
  },

  mistralSmall: {
    provider: "mistral",
    model: "mistral-small-latest",
    label: "Mistral Small",
    approxCostPer1kTokens: 0.0005,
  },

  mistralLarge: {
    provider: "mistral",
    model: "mistral-large-latest",
    label: "Mistral Large",
    approxCostPer1kTokens: 0.004,
  },
};

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

function getConfigForTier(tier) {
  return TIER_CONFIG[tier] || TIER_CONFIG.moderate;
}

function getConfigForExplicitModel(modelName) {
  return EXPLICIT_MODEL_ALIASES[modelName.toLowerCase()] || null;
}

module.exports = {
  TIER_CONFIG,
  getConfigForTier,
  getConfigForExplicitModel,
};