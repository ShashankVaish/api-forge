/**
 * complexityTest.js
 *
 * Runs every fixture in complexityFixtures.js through the analyzer and
 * prints a pass/fail table. Exits 1 if anything fails, so it works in CI.
 *
 *   npm run test:complexity
 *
 * No test framework needed — the analyzer is a pure function, so a loop
 * and a few asserts are enough.
 */

const { analyzeComplexity } = require("../src/complexityAnalyzer");
const fixtures = require("./complexityFixtures");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Calls the analyzer the same way modelRouter does. */
function run(fixture) {
  if (fixture.messages) {
    const lastUser = [...fixture.messages]
      .reverse()
      .find((m) => m.role === "user");
    return analyzeComplexity(lastUser ? lastUser.content : "", {
      contextMessageCount: fixture.messages.length,
      messages: fixture.messages,
    });
  }
  return analyzeComplexity(fixture.prompt, {
    contextMessageCount: 1,
    messages: [{ role: "user", content: fixture.prompt }],
  });
}

/** Returns a list of human-readable failures for one fixture. */
function check(expect, result) {
  const failures = [];

  if (expect.tier && result.tier !== expect.tier) {
    failures.push(`tier is "${result.tier}", expected "${expect.tier}"`);
  }

  if (expect.tierIn && !expect.tierIn.includes(result.tier)) {
    failures.push(
      `tier is "${result.tier}", expected one of ${expect.tierIn.join(" / ")}`,
    );
  }

  if (expect.tierNot && result.tier === expect.tierNot) {
    failures.push(`tier is "${result.tier}", expected anything else`);
  }

  if (expect.keywordHits !== undefined) {
    const hits = result.signals?.keywordHits;
    if (hits === undefined) {
      failures.push("analyzer does not report signals.keywordHits yet");
    } else if (hits !== expect.keywordHits) {
      failures.push(
        `keywordHits is ${hits}, expected ${expect.keywordHits}`,
      );
    }
  }

  if (expect.sizeAtLeast !== undefined) {
    if (result.size === undefined) {
      failures.push("analyzer does not report a size score yet");
    } else if (result.size < expect.sizeAtLeast) {
      failures.push(
        `size is ${result.size}, expected at least ${expect.sizeAtLeast}`,
      );
    }
  }

  if (expect.difficultyAtMost !== undefined) {
    if (result.difficulty === undefined) {
      failures.push("analyzer does not report a difficulty score yet");
    } else if (result.difficulty > expect.difficultyAtMost) {
      failures.push(
        `difficulty is ${result.difficulty}, expected at most ${expect.difficultyAtMost}`,
      );
    }
  }

  return failures;
}

let passed = 0;
const failed = [];

console.log("\nComplexity analyzer — fixture results\n");

for (const fixture of fixtures) {
  let result;
  try {
    result = run(fixture);
  } catch (err) {
    failed.push({ fixture, failures: [`threw: ${err.message}`] });
    console.log(`${RED}FAIL${RESET}  #${fixture.id}  ${fixture.note}`);
    console.log(`      ${RED}threw: ${err.message}${RESET}`);
    continue;
  }

  const failures = check(fixture.expect, result);
  const scores =
    result.difficulty !== undefined
      ? `diff=${result.difficulty} size=${result.size}`
      : `score=${result.score}`;

  if (failures.length === 0) {
    passed += 1;
    console.log(
      `${GREEN}PASS${RESET}  #${fixture.id}  ${fixture.note}  ${DIM}[${result.tier} ${scores}]${RESET}`,
    );
  } else {
    failed.push({ fixture, failures });
    console.log(
      `${RED}FAIL${RESET}  #${fixture.id}  ${fixture.note}  ${DIM}[${result.tier} ${scores}]${RESET}`,
    );
    for (const f of failures) console.log(`      ${RED}${f}${RESET}`);
  }
}

console.log(
  `\n${passed} passed, ${failed.length} failed, ${fixtures.length} total\n`,
);

if (failed.length > 0) process.exit(1);
