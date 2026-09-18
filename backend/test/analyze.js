/**
 * analyze.js
 *
 * Scores one prompt from the command line and prints every signal the
 * analyzer used — without starting the server or calling any provider.
 *
 *   npm run analyze -- "your prompt here"
 *   npm run analyze -- --file ./some-long-prompt.txt
 *
 * Use this when tuning config/complexityWeights.js: change a number, re-run,
 * see exactly which signal moved.
 */

const fs = require("fs");
const { analyzeComplexity } = require("../src/complexityAnalyzer");
const { getConfigForTier } = require("../src/config/models");

const args = process.argv.slice(2);
let prompt;

if (args[0] === "--file") {
  if (!args[1]) {
    console.error("Usage: npm run analyze -- --file <path>");
    process.exit(1);
  }
  prompt = fs.readFileSync(args[1], "utf-8");
} else {
  prompt = args.join(" ");
}

if (!prompt || !prompt.trim()) {
  console.error('Usage: npm run analyze -- "your prompt here"');
  process.exit(1);
}

const result = analyzeComplexity(prompt, {
  contextMessageCount: 1,
  messages: [{ role: "user", content: prompt }],
});

const model = getConfigForTier(result.tier);
const preview = prompt.length > 120 ? prompt.slice(0, 120) + "…" : prompt;

console.log("\n" + "─".repeat(64));
console.log(`PROMPT     ${preview.replace(/\n/g, " ")}`);
console.log("─".repeat(64));
console.log(`TIER       ${result.tier}`);
console.log(`ROUTES TO  ${model.label}  (${model.provider}/${model.model})`);
console.log("");
console.log(`difficulty ${String(result.difficulty).padStart(3)}/100   (picks the tier)`);
console.log(`size       ${String(result.size).padStart(3)}/100   (drives cost + context window)`);
console.log(`confidence ${result.confidence}      (1 = far from a cutoff, 0 = borderline)`);
console.log("");
console.log("SIGNALS");
for (const [k, v] of Object.entries(result.signals)) {
  console.log(`  ${k.padEnd(20)} ${Array.isArray(v) ? v.join(", ") || "—" : v}`);
}
console.log("");
console.log("REASONS");
if (result.reasons.length === 0) {
  console.log("  (no signals fired — scored on length alone)");
}
for (const r of result.reasons) console.log(`  • ${r}`);
console.log("─".repeat(64) + "\n");
