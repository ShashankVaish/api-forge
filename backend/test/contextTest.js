/**
 * contextTest.js
 *
 * Runs every fixture in contextFixtures.js through contextManager and
 * prints a pass/fail table. Exits 1 on any failure.
 *
 *   npm run test:context
 *
 * Everything under test is pure — no network, no provider keys needed.
 * The `keys` list in each fixture stands in for "which provider keys are
 * configured" via the hasKey() hook.
 */

const { fixtures, contextErrorMessages, notContextErrorMessages } =
  require("./contextFixtures");
const { estimateMessagesTokens } = require("../src/tokenEstimator");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let cm;
try {
  cm = require("../src/contextManager");
} catch (err) {
  console.log(`\n${RED}contextManager.js could not be loaded: ${err.message}${RESET}`);
  console.log(`${RED}0 passed, ${fixtures.length + 2} failed${RESET}\n`);
  process.exit(1);
}

function runPlan(input) {
  const keys = new Set(input.keys || []);
  return cm.planContext({
    messages: input.messages,
    candidates: input.candidates,
    expectedOutputTokens: input.expectedOutputTokens,
    requestedMaxTokens: input.requestedMaxTokens,
    allowModelSwitch: input.allowModelSwitch !== false,
    hasKey: (provider) => keys.has(provider),
  });
}

function check(expect, plan, input) {
  const f = [];
  const ctx = plan.context;

  if (expect.modelKey && plan.model.key !== expect.modelKey) {
    f.push(`model is "${plan.model.key}", expected "${expect.modelKey}"`);
  }
  if (expect.upgraded !== undefined && ctx.upgradedModel !== expect.upgraded) {
    f.push(`upgradedModel is ${ctx.upgradedModel}, expected ${expect.upgraded}`);
  }
  if (expect.trimmed !== undefined) {
    const was = ctx.trimmed !== null;
    if (was !== expect.trimmed) f.push(`trimmed is ${was}, expected ${expect.trimmed}`);
  }
  if (expect.maxTokensOut !== undefined && plan.maxTokensOut !== expect.maxTokensOut) {
    f.push(`maxTokensOut is ${plan.maxTokensOut}, expected ${expect.maxTokensOut}`);
  }
  if (expect.keepsSystem) {
    const inCount = input.messages.filter((m) => m.role === "system").length;
    const outCount = plan.messages.filter((m) => m.role === "system").length;
    if (inCount !== outCount) f.push(`system messages: kept ${outCount} of ${inCount}`);
  }
  if (expect.keepsLastUser) {
    const last = [...input.messages].reverse().find((m) => m.role === "user");
    if (!plan.messages.includes(last)) f.push("last user message was dropped");
  }
  if (expect.keepsFirstUser) {
    const first = input.messages.find((m) => m.role === "user");
    if (!plan.messages.includes(first)) f.push("first user message was dropped");
  }
  if (expect.droppedAtLeast !== undefined) {
    const n = ctx.trimmed?.droppedMessages ?? 0;
    if (n < expect.droppedAtLeast) f.push(`dropped ${n} messages, expected at least ${expect.droppedAtLeast}`);
  }
  if (expect.fitsAfter) {
    const b = cm.budgetFor(plan.model, estimateMessagesTokens(plan.messages), input.expectedOutputTokens, input.requestedMaxTokens);
    if (!b.fits) f.push(`trimmed result still does not fit (${b.paddedInput} + ${b.reserved} > ${plan.model.contextWindow})`);
  }
  if (expect.contextWindowReported !== undefined && ctx.contextWindow !== expect.contextWindowReported) {
    f.push(`context.contextWindow is ${ctx.contextWindow}, expected ${expect.contextWindowReported}`);
  }
  if (expect.utilizationApprox !== undefined) {
    if (Math.abs(ctx.utilization - expect.utilizationApprox) > 0.02) {
      f.push(`utilization is ${ctx.utilization}, expected ~${expect.utilizationApprox}`);
    }
  }
  return f;
}

let passed = 0;
let failed = 0;

console.log("\nContext manager — fixture results\n");

for (const fx of fixtures) {
  let plan;
  let thrown = null;
  try {
    plan = runPlan(fx.input);
  } catch (err) {
    thrown = err;
  }

  let failures = [];
  let summary = "";

  if (fx.expect.throws) {
    if (!thrown) failures.push(`expected ${fx.expect.throws} to be thrown, got a plan`);
    else if (thrown.name !== fx.expect.throws) failures.push(`threw ${thrown.name}, expected ${fx.expect.throws}: ${thrown.message}`);
    else if (fx.expect.status && thrown.status !== fx.expect.status) failures.push(`status is ${thrown.status}, expected ${fx.expect.status}`);
    summary = thrown ? `threw ${thrown.name}` : "no throw";
  } else if (thrown) {
    failures.push(`threw unexpectedly: ${thrown.name}: ${thrown.message}`);
    summary = "threw";
  } else {
    failures = check(fx.expect, plan, fx.input);
    const c = plan.context;
    summary = `${plan.model.key} in=${c.inputTokens} out<=${plan.maxTokensOut} util=${c.utilization}` +
      (c.upgradedModel ? " upgraded" : "") +
      (c.trimmed ? ` trimmed(-${c.trimmed.droppedMessages})` : "");
  }

  if (failures.length === 0) {
    passed++;
    console.log(`${GREEN}PASS${RESET}  #${fx.id}  ${fx.note}  ${DIM}[${summary}]${RESET}`);
  } else {
    failed++;
    console.log(`${RED}FAIL${RESET}  #${fx.id}  ${fx.note}  ${DIM}[${summary}]${RESET}`);
    for (const m of failures) console.log(`      ${RED}${m}${RESET}`);
  }
}

// Error classification — two grouped checks.
{
  const misses = contextErrorMessages.filter((m) => !cm.isContextLengthError(new Error(m)));
  if (misses.length === 0) {
    passed++;
    console.log(`${GREEN}PASS${RESET}  #E1 recognises every provider's "too long" error`);
  } else {
    failed++;
    console.log(`${RED}FAIL${RESET}  #E1 recognises every provider's "too long" error`);
    for (const m of misses) console.log(`      ${RED}missed: ${m.slice(0, 90)}${RESET}`);
  }

  const falsePositives = notContextErrorMessages.filter((m) => cm.isContextLengthError(new Error(m)));
  if (falsePositives.length === 0) {
    passed++;
    console.log(`${GREEN}PASS${RESET}  #E2 does not misclassify auth / rate-limit / network errors`);
  } else {
    failed++;
    console.log(`${RED}FAIL${RESET}  #E2 does not misclassify auth / rate-limit / network errors`);
    for (const m of falsePositives) console.log(`      ${RED}false positive: ${m}${RESET}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
