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
 */

// Keywords that usually correlate with harder reasoning / longer outputs.
const HIGH_COMPLEXITY_KEYWORDS = [
  "architecture", "algorithm", "optimize", "refactor", "debug",
  "step by step", "step-by-step", "compare", "trade-off", "tradeoff",
  "design a system", "explain in detail", "prove", "derive",
  "analyze", "analyse", "multi-step", "edge case", "time complexity",
  "security", "concurrency", "distributed", "scalability"
];

const LOW_COMPLEXITY_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|cool)\b/i,
  /^what is\s.{1,25}\??$/i,
  /^define\s/i,
  /^who is\s/i,
];

function countWords(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

function countCodeBlocks(text) {
  return (text.match(/```/g) || []).length / 2;
}

function countQuestions(text) {
  return (text.match(/\?/g) || []).length;
}

function keywordHits(text) {
  const lower = text.toLowerCase();
  return HIGH_COMPLEXITY_KEYWORDS.filter(k => lower.includes(k));
}

/**
 * Returns:
 *  {
 *    score: number (0-100),
 *    tier: "simple" | "moderate" | "complex",
 *    reasons: string[]   // human-readable explanation, useful for logs/demo
 *  }
 */
function analyzeComplexity(promptText, opts = {}) {
  const text = String(promptText || "");
  const reasons = [];
  let score = 0;

  // 1. Length signal
  const words = countWords(text);
  if (words < 8) {
    score += 0;
  } else if (words < 40) {
    score += 15;
  } else if (words < 120) {
    score += 30;
    reasons.push(`medium length prompt (${words} words)`);
  } else {
    score += 45;
    reasons.push(`long prompt (${words} words)`);
  }

  // 2. Explicit low-complexity pattern override (greetings, trivial lookups)
  const isTrivial = LOW_COMPLEXITY_PATTERNS.some(re => re.test(text.trim()));
  if (isTrivial) {
    reasons.push("matched a trivial-intent pattern (greeting / simple lookup)");
    return { score: 5, tier: "simple", reasons };
  }

  // 3. Code block presence -> usually needs a stronger model
  const codeBlocks = countCodeBlocks(text);
  if (codeBlocks > 0) {
    score += 20;
    reasons.push(`contains ${codeBlocks} code block(s)`);
  }

  // 4. Multiple sub-questions in one prompt
  const questions = countQuestions(text);
  if (questions > 1) {
    score += 10;
    reasons.push(`${questions} question marks (likely multi-part ask)`);
  }

  // 5. Keyword-based reasoning signal
  const hits = keywordHits(text);
  if (hits.length > 0) {
    score += Math.min(hits.length * 8, 30);
    reasons.push(`complexity keywords: ${hits.slice(0, 4).join(", ")}`);
  }

  // 6. Attachment / context size (if caller tells us there's prior context)
  if (opts.contextMessageCount && opts.contextMessageCount > 6) {
    score += 10;
    reasons.push(`long conversation context (${opts.contextMessageCount} messages)`);
  }

  score = Math.max(0, Math.min(100, score));

  let tier;
  if (score < 25) tier = "simple";
  else if (score < 55) tier = "moderate";
  else tier = "complex";

  return { score, tier, reasons };
}

module.exports = { analyzeComplexity };
