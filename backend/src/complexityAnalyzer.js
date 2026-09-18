/**
 * complexityAnalyzer.js
 *
 * Core idea of API Forge: instead of always hitting the most expensive model,
 * we score every incoming prompt on a few cheap, fast, heuristic signals and
 * decide how "hard" the request likely is. That score maps to a model tier.
 *
 * This is intentionally heuristic (no extra LLM call to judge complexity —
 * that would defeat the purpose of saving tokens/cost). Everything here runs
 * in microseconds, in-process, before any API call is made.
 *
 * TWO AXES
 * --------
 * A single score cannot describe a request, because two different things
 * drive cost and model choice:
 *
 *   difficulty — how much reasoning is needed  -> picks the TIER
 *   size       — how many tokens flow in/out   -> picks the CONTEXT WINDOW
 *                                                 and drives cost estimates
 *
 * A 40,000-token document with "summarize this" is huge but easy: high size,
 * low difficulty. Routing it on one blended number gets it wrong either way.
 * See docs/complexity-analyzer.md and docs/context-window.md.
 *
 * All tunable numbers live in config/complexityWeights.js.
 */

const W = require("./config/complexityWeights");
const { estimateTokens, looksLikeCode } = require("./tokenEstimator");

// Keywords that usually correlate with harder reasoning / longer outputs.
const HIGH_COMPLEXITY_KEYWORDS = [
  "architecture", "algorithm", "optimize", "refactor", "debug",
  "step by step", "step-by-step", "compare", "trade-off", "tradeoff",
  "design a system", "explain in detail", "prove", "derive",
  "analyze", "analyse", "multi-step", "edge case", "time complexity",
  "security", "concurrency", "distributed", "scalability",
  // Comparison and failure-analysis phrasing: both reliably signal work
  // that a small model tends to get wrong.
  "difference between", "versus", "pros and cons",
  "race condition", "deadlock", "memory leak", "bottleneck", "stack trace",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompiled ONCE at module load. Whole-word matching only: a plain
// includes() check matches "prove" inside "improve" and "approved", which
// scored ordinary sentences as hard. The optional s/es suffix keeps plurals
// working, so "tradeoffs" still matches "tradeoff".
const KEYWORD_RES = HIGH_COMPLEXITY_KEYWORDS.map((k) => ({
  keyword: k,
  re: new RegExp(`\\b${escapeRegex(k)}(?:s|es)?\\b`, "i"),
}));

const LOW_COMPLEXITY_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|cool)\b/i,
  /^what is\s.{1,25}\??$/i,
  /^define\s/i,
  /^who is\s/i,
];

// Job types. Some work is cheap no matter how long it is (translation,
// summarising); some is expensive even when the prompt is one line.
const TASK_TYPES = [
  {
    name: "transform",
    re: /\b(translate|summari[sz]e|rewrite|reformat|convert|extract|proofread)\b/i,
  },
  {
    name: "reason",
    re: /\b(why|prove|derive|debug|bug|root cause|architect|design|diagnose|explain how)\b/i,
  },
];

// Signals that the ANSWER will be long. Output tokens usually cost several
// times more than input tokens, so this was the largest blind spot.
const GENERATE_VERB_RE =
  /\b(write|generate|implement|build|create|design|draft|compose)\b/i;
const DOCUMENT_NOUN_RE =
  /\b(essay|article|report|documentation|tutorial|guide|blog post|whitepaper|spec|specification|design doc)\b/i;
const THOROUGHNESS_RE =
  /\b(full|complete|entire|comprehensive|detailed|in depth|in-depth|exhaustive)\b/i;
const EXPLICIT_COUNT_RE =
  /(\d[\d,]*)\s*[- ]?\s*(words?|lines?|items?|examples?|paragraphs?|pages?|bullet points?)/i;
const LIST_COUNT_RE = /\blist\s+(\d[\d,]*)\b/i;

// Signals that the answer should be SHORT. The old analyzer had no way to
// score a prompt downward at all.
const BREVITY_RE =
  /\b(briefly|concisely|in one sentence|in a sentence|one word|yes or no|tl;?dr|just the code|short answer|no explanation)\b/i;

const TIERS = ["simple", "moderate", "complex"];

// ── small helpers ──────────────────────────────────────────────────────

function pickByThreshold(table, value, valueKey, pointsKey = "points") {
  for (const row of table) {
    if (value <= row[valueKey]) return row[pointsKey];
  }
  return table[table.length - 1][pointsKey];
}

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function tierFromDifficulty(difficulty) {
  if (difficulty < W.cutoffs.simpleMax) return "simple";
  if (difficulty < W.cutoffs.moderateMax) return "moderate";
  return "complex";
}

function countQuestions(text) {
  return (text.match(/\?/g) || []).length;
}

function keywordHits(text) {
  return KEYWORD_RES.filter(({ re }) => re.test(text)).map((k) => k.keyword);
}

/**
 * Counts LINES of code, not fence pairs.
 *
 * The old version did (count of ``` ) / 2, which returned 0.5 for an
 * unclosed fence, gave a 3-character snippet the same weight as a 300-line
 * paste, and completely missed code pasted without any fences at all.
 */
function countCodeLines(text) {
  const lines = text.split("\n");
  let inFence = false;
  let fencedLines = 0;
  let sawFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      sawFence = true;
      inFence = !inFence;
      continue;
    }
    if (inFence && line.trim()) fencedLines += 1;
  }

  if (fencedLines > 0) return fencedLines;

  // No usable fenced content (including the unclosed-fence case): fall back
  // to structural detection so a raw paste is still seen.
  if (!sawFence && looksLikeCode(text)) {
    return lines.filter((l) => {
      const t = l.trim();
      if (!t) return false;
      return (
        /[;{}]\s*$/.test(t) ||
        /^(function|class|def|import|export|const|let|var|if|for|while|return|public|private)\b/.test(t) ||
        /=>/.test(t)
      );
    }).length;
  }

  return 0;
}

/** Largest explicitly requested count, e.g. "2000 words" or "list 50". */
function explicitRequestedCount(text) {
  const counts = [];
  const m1 = text.match(EXPLICIT_COUNT_RE);
  if (m1) counts.push(Number(m1[1].replace(/,/g, "")));
  const m2 = text.match(LIST_COUNT_RE);
  if (m2) counts.push(Number(m2[1].replace(/,/g, "")));
  return counts.length ? Math.max(...counts) : 0;
}

// ── the two axes ───────────────────────────────────────────────────────

/**
 * How ambitious is the requested OUTPUT? Feeds difficulty (a big generation
 * job needs a capable model) and size (it needs context-window headroom).
 */
function scoreGeneration(text, reasons) {
  const G = W.difficulty.generation;
  let points = 0;

  const requested = explicitRequestedCount(text);
  if (requested > 0) {
    // explicitCount is an "at least" table, ordered largest first.
    const row = G.explicitCount.find((r) => requested >= r.minCount);
    if (row) points += row.points;
    reasons.push(`explicitly asked for ${requested} units of output`);
  }

  if (DOCUMENT_NOUN_RE.test(text)) {
    points += G.documentNoun;
    reasons.push("asks for a document-shaped answer");
  }
  if (THOROUGHNESS_RE.test(text)) {
    points += G.thoroughness;
    reasons.push("asks for a thorough answer");
  }
  if (GENERATE_VERB_RE.test(text)) {
    points += G.generateVerb;
  }

  return { points: Math.min(points, G.cap), requestedCount: requested };
}

/** Estimated tokens the ANSWER will take — used to reserve window space. */
function estimateOutputTokens(text, generation) {
  const S = W.size;
  if (BREVITY_RE.test(text)) return S.briefOutputTokens;

  let tokens = S.defaultOutputTokens;
  if (generation.requestedCount > 0) {
    tokens = Math.max(
      tokens,
      Math.ceil(generation.requestedCount * S.tokensPerRequestedWord),
    );
  }
  if (DOCUMENT_NOUN_RE.test(text)) {
    tokens = Math.max(tokens, S.documentOutputTokens);
  }
  return Math.min(tokens, S.maxOutputTokens);
}

/**
 * Scores ONE message. Returns both axes plus the raw signals, which the
 * test suite asserts on and `reasons[]` is built from.
 */
function scoreOne(promptText, opts = {}) {
  const text = String(promptText || "");
  const trimmed = text.trim();
  const reasons = [];
  const D = W.difficulty;

  const inputTokens = estimateTokens(text);

  // Trivial-intent shortcut. Gated on LENGTH — without that gate,
  // "Hi, can you design a distributed system..." matched the greeting
  // pattern and returned 5, sending a hard question to the cheapest model.
  const isTrivial =
    inputTokens <= W.trivialMaxTokens &&
    LOW_COMPLEXITY_PATTERNS.some((re) => re.test(trimmed));

  if (isTrivial) {
    reasons.push("matched a trivial-intent pattern (greeting / simple lookup)");
    return {
      difficulty: W.trivialScore,
      size: W.size.inputByTokens[0].points,
      reasons,
      signals: {
        keywordHits: 0,
        keywords: [],
        codeLines: 0,
        questionCount: countQuestions(text),
        taskType: null,
        inputTokens,
        conversationTokens: opts.conversationTokens || inputTokens,
        expectedOutputTokens: W.size.briefOutputTokens,
        trivial: true,
      },
    };
  }

  let difficulty = 0;

  // 1. Complexity keywords (whole words only).
  const hits = keywordHits(text);
  if (hits.length > 0) {
    difficulty += Math.min(hits.length * D.perKeyword, D.keywordCap);
    reasons.push(`complexity keywords: ${hits.slice(0, 4).join(", ")}`);
  }

  // 2. Code, weighted by how much there is.
  const codeLines = countCodeLines(text);
  if (codeLines > 0) {
    difficulty += pickByThreshold(D.codeLines, codeLines, "maxLines");
    reasons.push(`contains ~${codeLines} line(s) of code`);
  }

  // 3. Multi-part questions.
  const questionCount = countQuestions(text);
  if (questionCount > 1) {
    difficulty += D.multiQuestion;
    reasons.push(`${questionCount} question marks (likely multi-part ask)`);
  }

  // 4. Job type — cheap transforms down, reasoning work up.
  let taskType = null;
  for (const t of TASK_TYPES) {
    if (t.re.test(text)) {
      taskType = t.name;
      difficulty += D.taskType[t.name];
      reasons.push(
        t.name === "transform"
          ? "looks like a transform job (long but mechanical)"
          : "looks like a reasoning job",
      );
      break;
    }
  }

  // 5. How big an answer is being asked for.
  const generation = scoreGeneration(text, reasons);
  difficulty += generation.points;

  // 6. Explicit brevity pulls the score back down.
  if (BREVITY_RE.test(text)) {
    difficulty += D.brevity;
    reasons.push("explicitly asks for a short answer");
  }

  // 7. Input length — capped low on purpose. A big paste is expensive but
  //    not necessarily hard; volume belongs on the size axis.
  const lengthPoints = pickByThreshold(D.lengthByTokens, inputTokens, "maxTokens");
  difficulty += lengthPoints;
  if (lengthPoints >= 14) {
    reasons.push(`long prompt (~${inputTokens} tokens)`);
  }

  // 8. Long conversations carry accumulated context.
  if (
    opts.contextMessageCount &&
    opts.contextMessageCount > D.longConversationMessages
  ) {
    difficulty += D.longConversation;
    reasons.push(`long conversation context (${opts.contextMessageCount} messages)`);
  }

  // ── size axis ────────────────────────────────────────────────────────
  const expectedOutputTokens = estimateOutputTokens(text, generation);
  const totalInputTokens = opts.conversationTokens || inputTokens;

  const size = clamp(
    pickByThreshold(W.size.inputByTokens, totalInputTokens, "maxTokens") +
      (expectedOutputTokens / W.size.maxOutputTokens) * 100 * W.size.outputWeight,
  );

  return {
    difficulty: clamp(difficulty),
    size,
    reasons,
    signals: {
      keywordHits: hits.length,
      keywords: hits,
      codeLines,
      questionCount,
      taskType,
      inputTokens,
      conversationTokens: totalInputTokens,
      expectedOutputTokens,
      trivial: false,
    },
  };
}

// ── public API ─────────────────────────────────────────────────────────

/**
 * Returns:
 *  {
 *    difficulty: number (0-100)   // how much reasoning is needed
 *    size:       number (0-100)   // how many tokens flow in and out
 *    score:      number (0-100)   // kept for API compatibility (= difficulty)
 *    tier:       "simple" | "moderate" | "complex"
 *    confidence: number (0-1)     // how far the score sits from a cutoff
 *    reasons:    string[]         // human-readable, surfaced in the UI
 *    signals:    object           // raw feature values, used by tests
 *  }
 *
 * @param {string} promptText  the latest user message
 * @param {object} opts
 * @param {number} opts.contextMessageCount  total messages in the conversation
 * @param {Array}  opts.messages             full history, for the sticky tier
 */
function analyzeComplexity(promptText, opts = {}) {
  const messages = Array.isArray(opts.messages) ? opts.messages : [];

  // Total conversation volume — 6 one-word turns are not the same as 6 long
  // ones, which is all `messages.length` could ever tell us.
  const conversationTokens = messages.length
    ? messages.reduce((t, m) => t + estimateTokens(m?.content), 0)
    : estimateTokens(promptText);

  const current = scoreOne(promptText, { ...opts, conversationTokens });

  let tier = tierFromDifficulty(current.difficulty);
  const reasons = [...current.reasons];

  // Sticky tier: a follow-up like "continue" scores 0 on its own. Without
  // this, a hard conversation drops from the strongest model to the weakest
  // in a single turn, and answer quality falls off a cliff mid-thread.
  if (W.sticky.enabled && messages.length > 1) {
    const priorUserMessages = messages
      .filter((m) => m.role === "user")
      .slice(0, -1);

    let priorBest = -1;
    for (const m of priorUserMessages) {
      const prior = scoreOne(m.content, { contextMessageCount: messages.length });
      priorBest = Math.max(priorBest, TIERS.indexOf(tierFromDifficulty(prior.difficulty)));
    }

    if (priorBest > -1) {
      const floor = Math.max(0, priorBest - W.sticky.maxDropPerTurn);
      if (TIERS.indexOf(tier) < floor) {
        reasons.push(
          `held at "${TIERS[floor]}" — earlier turns in this conversation were ${TIERS[priorBest]}`,
        );
        tier = TIERS[floor];
      }
    }
  }

  // Boundary handling: 44 and 45 should not produce wildly different answer
  // quality, so a score sitting just BELOW the next tier's cutoff is rounded
  // up. Only the cutoff directly above the current tier counts — measuring
  // distance to any cutoff would promote a mid-range score to "complex"
  // just because it sat near the simple/moderate line.
  const confidence = Number(
    Math.min(
      1,
      Math.min(
        Math.abs(current.difficulty - W.cutoffs.simpleMax),
        Math.abs(current.difficulty - W.cutoffs.moderateMax),
      ) / 15,
    ).toFixed(2),
  );

  const tierIdx = TIERS.indexOf(tier);
  const nextCutoff =
    tierIdx === 0
      ? W.cutoffs.simpleMax
      : tierIdx === 1
        ? W.cutoffs.moderateMax
        : null;

  if (nextCutoff !== null) {
    const gap = nextCutoff - current.difficulty;
    if (gap >= 0 && gap <= W.boundaryMargin) {
      tier = TIERS[tierIdx + 1];
      reasons.push(
        `borderline score (${current.difficulty}, cutoff ${nextCutoff}) — rounded up a tier`,
      );
    }
  }

  return {
    difficulty: current.difficulty,
    size: current.size,
    score: current.difficulty, // back-compat: RoutingInfo.complexityScore
    tier,
    confidence,
    reasons,
    signals: current.signals,
  };
}

module.exports = { analyzeComplexity, tierFromDifficulty };
