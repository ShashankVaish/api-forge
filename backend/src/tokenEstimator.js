/**
 * tokenEstimator.js
 *
 * Models charge by TOKEN, not by word. A token is roughly a piece of a
 * word — about 4 characters of English prose, but closer to 3 for code
 * (punctuation and short identifiers tokenize densely).
 *
 * This is deliberately a cheap local estimate, not an exact count:
 *   - The analyzer runs on every request, so it must stay in microseconds.
 *   - Every provider tokenizes differently anyway, so an "exact" number
 *     from one provider's tokenizer would still be wrong for the others.
 *     Callers should add a safety margin (see docs/context-window.md).
 *
 * Upgrade path: swap the body of estimateTokens() for the `gpt-tokenizer`
 * npm package. It also runs locally, so the no-network rule still holds.
 */

// Signals that the text is code rather than prose.
const CODE_HINT_RE =
  /```|(^|\n)\s*(function|class|def|import|const|let|var|public|private)\s|=>|;\s*$|\bSELECT\b.*\bFROM\b/im;

// CJK and Hangul characters are roughly one token each, and they do not
// separate on whitespace — so word-splitting badly under-counts them.
const CJK_RE = /[　-鿿가-힯＀-￯]/g;

function looksLikeCode(text) {
  return CODE_HINT_RE.test(text);
}

/**
 * Rough token count for a single string.
 * @returns {number}
 */
function estimateTokens(text) {
  const s = String(text || "");
  if (!s) return 0;

  const cjkCount = (s.match(CJK_RE) || []).length;
  const remaining = s.length - cjkCount;
  const divisor = looksLikeCode(s) ? 3 : 4;

  return Math.ceil(cjkCount + remaining / divisor);
}

/** Rough token count across a whole messages array. */
function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  // ~4 tokens of per-message overhead for role markers and separators.
  return messages.reduce(
    (total, m) => total + estimateTokens(m?.content) + 4,
    0,
  );
}

module.exports = { estimateTokens, estimateMessagesTokens, looksLikeCode };
