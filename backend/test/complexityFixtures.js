/**
 * complexityFixtures.js
 *
 * Test cases for the complexity analyzer (see docs/task.md).
 *
 * Each fixture is either a single `prompt` string or a full `messages`
 * array, plus an `expect` block. Assertions are optional — a fixture that
 * only sets `tier` is checked on tier alone, so this file works against the
 * old single-score analyzer AND the new two-axis one.
 *
 * Supported assertions:
 *   tier          exact tier match
 *   tierIn        tier must be one of these
 *   tierNot       tier must NOT be this
 *   keywordHits   exact number of complexity-keyword matches
 *   sizeAtLeast   size score floor        (two-axis analyzer only)
 *   difficultyAtMost  difficulty ceiling  (two-axis analyzer only)
 */

// A long-ish paste of unfenced code, to prove we detect code without ```.
const UNFENCED_CODE = Array.from({ length: 300 }, (_, i) =>
  i % 5 === 0
    ? `function handler${i}(req, res) {`
    : i % 5 === 4
      ? "}"
      : `  const value${i} = compute(req.params.id, ${i});`,
).join("\n");

// ~40k words of filler, to simulate a giant pasted document.
const HUGE_DOCUMENT = Array.from(
  { length: 40000 },
  (_, i) => `word${i % 500}`,
).join(" ");

const FIVE_HUNDRED_WORDS = Array.from(
  { length: 500 },
  (_, i) => `mot${i % 200}`,
).join(" ");

const HARD_QUESTION =
  "Design a distributed job queue that survives a full region outage. " +
  "Walk me through the tradeoffs between at-least-once and exactly-once delivery.";

module.exports = [
  {
    id: 1,
    note: "greeting prefix must not cancel a hard question (T1.1)",
    prompt:
      "Hi, can you design a distributed rate limiter with consistent hashing " +
      "and walk me through the tradeoffs?",
    expect: { tier: "complex" },
  },
  {
    id: 2,
    note: "big explicit output request is expensive (T2.3)",
    prompt:
      "Write a complete 2000-word technical essay on the history of database indexing.",
    expect: { tier: "complex" },
  },
  {
    id: 3,
    note: "keywords must not match inside other words (T1.2)",
    prompt:
      "the improved approach was approved and is comparable to the analyser output",
    expect: { tier: "simple", keywordHits: 0 },
  },
  {
    id: 4,
    note: "a one-line code snippet is not complex (T1.3)",
    prompt: "Refactor this:\n```js\nconst x = 1;\n```",
    expect: { tier: "simple" },
  },
  {
    id: 5,
    note: "follow-up must not crash to simple mid-conversation (T3.1)",
    messages: [
      { role: "user", content: HARD_QUESTION },
      { role: "assistant", content: "Here is one approach: ..." },
      { role: "user", content: "continue" },
    ],
    expect: { tierNot: "simple" },
  },
  {
    id: 6,
    note: "plain greeting is still simple (T1.1 regression)",
    prompt: "hi",
    expect: { tier: "simple" },
  },
  {
    id: 7,
    note: "short lookup shortcut still works",
    prompt: "what is a monad?",
    expect: { tier: "simple" },
  },
  {
    id: 8,
    note: "translation is long but easy (T2.5)",
    prompt: `Translate this paragraph into French: ${FIVE_HUNDRED_WORDS}`,
    expect: { tierIn: ["simple", "moderate"] },
  },
  {
    id: 9,
    note: "explicit brevity lowers the score (T2.4)",
    prompt: "explain quantum computing in one sentence",
    expect: { tier: "simple" },
  },
  {
    id: 10,
    note: "architecture + comparison is complex (regression)",
    prompt:
      "Design a multi-region database failover strategy and compare the tradeoffs",
    expect: { tier: "complex" },
  },
  {
    id: 11,
    note: "large unfenced code paste is detected (T1.3)",
    prompt: `find the bug in this code\n${UNFENCED_CODE}`,
    expect: { tier: "complex" },
  },
  {
    id: 12,
    note: "huge but easy: high size, low difficulty (T2.2)",
    prompt: `summarize this\n${HUGE_DOCUMENT}`,
    expect: { sizeAtLeast: 70, difficultyAtMost: 30 },
  },
];
