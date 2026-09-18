/**
 * routerTest.js
 *
 * Exercises modelRouter.routeRequest() end to end with FAKE providers
 * injected through its `deps` argument — no network, no keys.
 *
 *   npm run test:router
 *
 * Covers the paths the pure context tests cannot: retry on a "too long"
 * upstream error, summarising dropped turns, truncation reporting,
 * explicit-model-never-switches, and 413 surfacing.
 */

const assert = require("node:assert/strict");
const { routeRequest } = require("../src/modelRouter");
const { TIER_CONFIG } = require("../src/config/models");
const C = require("../src/config/contextConfig");

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const tokensOf = (n) => "a".repeat(n * 4);

/** A provider whose behaviour is a script of responses, in call order. */
function fakeProvider(script) {
  const calls = [];
  return {
    calls,
    call: async (model, messages, apiKey, options) => {
      calls.push({ model, messages, options });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      if (step.throw) {
        const err = new Error(step.throw);
        err.status = 400;
        throw err;
      }
      return {
        text: step.text ?? "ok",
        usage: { input_tokens: 10, output_tokens: 5 },
        finishReason: step.finishReason ?? "stop",
      };
    },
  };
}

const keysFor = (...providers) =>
  Object.fromEntries(providers.map((p) => [p, `fake-${p}-key`]));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ── cases ──────────────────────────────────────────────────────────────

test("truncated answer is reported, not hidden (D8)", async () => {
  const groq = fakeProvider([{ finishReason: "length", text: "cut off mid" }]);
  const r = await routeRequest(
    { messages: [{ role: "user", content: "hi" }] },
    { providers: { groq }, providerKeys: keysFor("groq") },
  );
  assert.equal(r.routing.truncated, true);
  assert.equal(r.routing.finishReason, "length");
  assert.equal(r.routing.usedFallback, false);
});

test("retries once on a bigger model when upstream says 'too long' (D7)", async () => {
  const groq = fakeProvider([{ throw: "Groq API error (400): context_length_exceeded" }]);
  const gemini = fakeProvider([{ text: "answered by gemini" }]);
  const r = await routeRequest(
    { messages: [{ role: "user", content: "hi" }] },
    { providers: { groq, gemini }, providerKeys: keysFor("groq", "gemini") },
  );
  assert.equal(groq.calls.length, 1);
  assert.equal(gemini.calls.length, 1);
  assert.equal(r.routing.provider, "gemini");
  assert.equal(r.routing.context.retriedOnContextError, true);
  assert.equal(r.routing.usedFallback, false);
  assert.equal(r.text, "answered by gemini");
});

test("a non-context error does NOT trigger the retry", async () => {
  const groq = fakeProvider([{ throw: "Groq API error (401): Invalid API Key" }]);
  const gemini = fakeProvider([{ text: "should not be called" }]);
  const r = await routeRequest(
    { messages: [{ role: "user", content: "hi" }] },
    { providers: { groq, gemini }, providerKeys: keysFor("groq", "gemini") },
  );
  assert.equal(gemini.calls.length, 0);
  assert.equal(r.routing.usedFallback, true);
  assert.equal(r.routing.context.retriedOnContextError, false);
});

test("explicit model is never switched, even on a 'too long' error (D3)", async () => {
  const groq = fakeProvider([{ throw: "Groq API error (400): context_length_exceeded" }]);
  const gemini = fakeProvider([{ text: "should not be called" }]);
  const r = await routeRequest(
    { messages: [{ role: "user", content: "hi" }], requestedModel: "groq-fast" },
    { providers: { groq, gemini }, providerKeys: keysFor("groq", "gemini") },
  );
  assert.equal(gemini.calls.length, 0);
  assert.equal(r.routing.provider, "groq");
  assert.equal(r.routing.usedFallback, true);
});

test("max_tokens from the body reaches the provider and is capped (D9)", async () => {
  const groq = fakeProvider([{}]);
  await routeRequest(
    { messages: [{ role: "user", content: "hi" }], maxTokens: 123 },
    { providers: { groq }, providerKeys: keysFor("groq") },
  );
  assert.equal(groq.calls[0].options.maxOutputTokens, 123);

  const groq2 = fakeProvider([{}]);
  await routeRequest(
    { messages: [{ role: "user", content: "hi" }], maxTokens: 10_000_000 },
    { providers: { groq: groq2 }, providerKeys: keysFor("groq") },
  );
  assert.equal(groq2.calls[0].options.maxOutputTokens, C.gatewayMaxOutputTokens);
});

test("dropped turns are summarised by the cheap tier and injected (D6 step 5)", async () => {
  // Shrink groq-fast's window for this test so trimming triggers without
  // needing 100k+ tokens of fixture text.
  const saved = TIER_CONFIG.groqFast.contextWindow;
  TIER_CONFIG.groqFast.contextWindow = 2000;
  try {
    const messages = [
      { role: "system", content: "You are terse." },
      { role: "user", content: tokensOf(400) },
      { role: "assistant", content: tokensOf(400) },
      { role: "user", content: tokensOf(400) },
      { role: "assistant", content: tokensOf(400) },
      { role: "user", content: "continue" },
    ];
    // First call is the summariser (simple tier = groq), second is the answer.
    const groq = fakeProvider([{ text: "SUMMARY: user asked things." }, { text: "final" }]);
    const r = await routeRequest(
      { messages, requestedModel: "groq-fast" },
      { providers: { groq }, providerKeys: keysFor("groq") },
    );
    assert.equal(groq.calls.length, 2, "summariser + answer = 2 calls");
    assert.equal(groq.calls[0].options.maxOutputTokens, C.summarize.maxSummaryTokens);
    const sent = groq.calls[1].messages;
    assert.ok(sent.some((m) => m.role === "system" && m.content.includes("SUMMARY: user asked things.")), "summary injected");
    assert.ok(sent.some((m) => m.content === "continue"), "last user message kept");
    assert.equal(sent[0].content, "You are terse.", "original system prompt kept first");
    assert.equal(r.routing.context.trimmed.strategy, "summarized");
    assert.ok(r.routing.context.trimmed.droppedMessages >= 1);
    assert.equal(r.text, "final");
  } finally {
    TIER_CONFIG.groqFast.contextWindow = saved;
  }
});

test("summariser failure falls back to a plain trim (fail-open)", async () => {
  const saved = TIER_CONFIG.groqFast.contextWindow;
  TIER_CONFIG.groqFast.contextWindow = 2000;
  try {
    const messages = [
      { role: "user", content: tokensOf(400) },
      { role: "assistant", content: tokensOf(400) },
      { role: "user", content: tokensOf(400) },
      { role: "assistant", content: tokensOf(400) },
      { role: "user", content: "continue" },
    ];
    const groq = fakeProvider([{ throw: "Groq API error (500): boom" }, { text: "final" }]);
    const r = await routeRequest(
      { messages, requestedModel: "groq-fast" },
      { providers: { groq }, providerKeys: keysFor("groq") },
    );
    assert.equal(r.routing.context.trimmed.strategy, "sliding-window");
    assert.equal(r.routing.usedFallback, false);
    assert.equal(r.text, "final");
  } finally {
    TIER_CONFIG.groqFast.contextWindow = saved;
  }
});

test("a single message larger than every window surfaces as 413", async () => {
  const saved = TIER_CONFIG.groqFast.contextWindow;
  TIER_CONFIG.groqFast.contextWindow = 1000;
  try {
    const groq = fakeProvider([{}]);
    await assert.rejects(
      routeRequest(
        { messages: [{ role: "user", content: tokensOf(5000) }], requestedModel: "groq-fast" },
        { providers: { groq }, providerKeys: keysFor("groq") },
      ),
      (err) => err.name === "ContextTooLargeError" && err.status === 413,
    );
    assert.equal(groq.calls.length, 0, "nothing was sent upstream");
  } finally {
    TIER_CONFIG.groqFast.contextWindow = saved;
  }
});

test("routing.context is populated on the happy path", async () => {
  const groq = fakeProvider([{}]);
  const r = await routeRequest(
    { messages: [{ role: "user", content: "hi" }] },
    { providers: { groq }, providerKeys: keysFor("groq") },
  );
  const c = r.routing.context;
  assert.equal(c.contextWindow, TIER_CONFIG.simple.contextWindow);
  assert.equal(c.upgradedModel, false);
  assert.equal(c.trimmed, null);
  assert.ok(c.utilization >= 0 && c.utilization <= 1);
  assert.ok(r.routing.maxTokensOut > 0);
});

// ── runner ─────────────────────────────────────────────────────────────

(async () => {
  process.env.ROUTING_LOG = "off";
  let passed = 0, failed = 0;
  console.log("\nModel router — integration results (fake providers)\n");
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`${GREEN}PASS${RESET}  ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`${RED}FAIL${RESET}  ${t.name}`);
      console.log(`      ${RED}${err.message.split("\n")[0]}${RESET}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total\n`);
  if (failed) process.exit(1);
})();
