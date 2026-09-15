/**
 * complexityWeights.js
 *
 * Every tunable number used by complexityAnalyzer.js lives here, so routing
 * behaviour can be changed without touching the scoring logic — and so two
 * weight sets can be compared against the same fixtures.
 *
 * The two tier cutoffs can also be overridden per-environment:
 *   COMPLEXITY_SIMPLE_MAX=22
 *   COMPLEXITY_MODERATE_MAX=45
 */

function envInt(name, fallback) {
  const raw = process.env[name];
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  // ── Tier cutoffs, applied to the DIFFICULTY score ────────────────────
  // difficulty < simpleMax            -> simple
  // difficulty < moderateMax          -> moderate
  // otherwise                         -> complex
  cutoffs: {
    simpleMax: envInt("COMPLEXITY_SIMPLE_MAX", 22),
    moderateMax: envInt("COMPLEXITY_MODERATE_MAX", 45),
  },

  // A score this close to a cutoff is treated as uncertain and rounded UP
  // a tier, so 44 and 45 do not produce wildly different answer quality.
  boundaryMargin: 3,

  // ── Trivial-intent shortcut ──────────────────────────────────────────
  // The greeting/lookup shortcut ONLY applies to messages at or under this
  // many tokens. Without this gate, "Hi, can you design a distributed
  // system..." scores as a greeting and goes to the cheapest model.
  trivialMaxTokens: 18,
  trivialScore: 5,

  // ── Difficulty signals ───────────────────────────────────────────────
  difficulty: {
    // Complexity keywords, matched on whole words only.
    perKeyword: 10,
    keywordCap: 35,

    // Code, scored by how much of it there is rather than yes/no.
    codeLines: [
      { maxLines: 0, points: 0 },
      { maxLines: 5, points: 5 },
      { maxLines: 30, points: 15 },
      { maxLines: Infinity, points: 25 },
    ],

    // More than one "?" suggests a multi-part question.
    multiQuestion: 10,

    // Task type deltas (see TASK_TYPES in complexityAnalyzer.js).
    taskType: {
      transform: -20, // translate / summarize / reformat — long but easy
      reason: 20, // why / prove / debug — hard even when short
    },

    // How much an explicit request for a long answer raises difficulty.
    // A big generation job needs a capable model, not just a big budget.
    generation: {
      explicitCount: [
        { minCount: 1000, points: 35 },
        { minCount: 300, points: 22 },
        { minCount: 50, points: 12 },
        { minCount: 1, points: 6 },
      ],
      documentNoun: 10, // essay, article, report, tutorial, guide
      thoroughness: 8, // full, complete, comprehensive, in depth
      generateVerb: 8, // write, implement, build, create, design
      cap: 45,
    },

    // Explicit brevity ("in one sentence", "yes or no") pulls the score down.
    brevity: -15,

    // Input length, capped low on purpose: a big paste is expensive, but
    // it is not necessarily HARD. Volume belongs on the size axis.
    lengthByTokens: [
      { maxTokens: 20, points: 0 },
      { maxTokens: 80, points: 5 },
      { maxTokens: 250, points: 8 },
      { maxTokens: 1000, points: 14 },
      { maxTokens: Infinity, points: 20 },
    ],

    // A long back-and-forth usually means accumulated context to track.
    longConversationMessages: 6,
    longConversation: 10,
  },

  // ── Size signals (token volume, for cost + context-window choice) ────
  size: {
    inputByTokens: [
      { maxTokens: 100, points: 5 },
      { maxTokens: 500, points: 15 },
      { maxTokens: 2000, points: 30 },
      { maxTokens: 10000, points: 50 },
      { maxTokens: 50000, points: 70 },
      { maxTokens: Infinity, points: 90 },
    ],

    // Expected answer size, in tokens, used to reserve context-window room.
    defaultOutputTokens: 800,
    briefOutputTokens: 150,
    tokensPerRequestedWord: 1.4,
    documentOutputTokens: 2500,
    maxOutputTokens: 32000,

    // How much the expected output adds to the size score.
    outputWeight: 0.6,
  },

  // ── Sticky tier (conversation memory) ────────────────────────────────
  // A follow-up like "continue" scores 0 on its own. Without this, a hard
  // conversation drops from the strongest model to the weakest in one turn.
  sticky: {
    enabled: true,
    // How many tiers the conversation may drop per turn.
    maxDropPerTurn: 1,
  },
};
