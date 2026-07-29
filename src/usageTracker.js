/**
 * usageTracker.js
 *
 * Very simple in-memory tracker (no DB, resets on server restart — fine for
 * a demo/prototype). Tracks how many requests went to each tier, and
 * estimates $ saved vs a "naive" baseline where every request always hits
 * the top-tier ("complex") model. This "savings" number is the whole
 * business case for API Forge, so it's worth surfacing via /stats.
 */

const { TIER_CONFIG } = require("./config/models");

const state = {
  totalRequests: 0,
  byTier: { simple: 0, moderate: 0, complex: 0 },
  totalInputTokens: 0,
  totalOutputTokens: 0,
};

function record({ tier, usage }) {
  state.totalRequests += 1;
  state.byTier[tier] = (state.byTier[tier] || 0) + 1;
  if (usage?.input_tokens) state.totalInputTokens += usage.input_tokens;
  if (usage?.output_tokens) state.totalOutputTokens += usage.output_tokens;
}

function getStats() {
  const totalTokens = state.totalInputTokens + state.totalOutputTokens;
  const avgTokensPerRequest = state.totalRequests
    ? totalTokens / state.totalRequests
    : 0;

  // Actual estimated cost given the tier each request actually used
  let actualCost = 0;
  for (const tier of Object.keys(state.byTier)) {
    const count = state.byTier[tier];
    const rate = TIER_CONFIG[tier].approxCostPer1kTokens;
    actualCost += count * avgTokensPerRequest * (rate / 1000);
  }

  // Baseline: what it would have cost if EVERY request used the top tier
  const complexRate = TIER_CONFIG.complex.approxCostPer1kTokens;
  const baselineCost = state.totalRequests * avgTokensPerRequest * (complexRate / 1000);

  const estimatedSavings = baselineCost - actualCost;
  const savingsPercent = baselineCost > 0 ? (estimatedSavings / baselineCost) * 100 : 0;

  return {
    totalRequests: state.totalRequests,
    byTier: state.byTier,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    estimatedActualCostUSD: Number(actualCost.toFixed(6)),
    estimatedBaselineCostUSD_ifAlwaysTopTier: Number(baselineCost.toFixed(6)),
    estimatedSavingsUSD: Number(estimatedSavings.toFixed(6)),
    estimatedSavingsPercent: Number(savingsPercent.toFixed(1)),
  };
}

module.exports = { record, getStats };
