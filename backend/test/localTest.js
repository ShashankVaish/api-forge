/**
 * test/localTest.js
 *
 * Demonstrates the ROUTING DECISION logic without needing any real API key
 * or network call. Great for showing in an interview: "here's the routing
 * engine deciding which model to use, in isolation, deterministically."
 *
 * Run: node test/localTest.js
 */

const { analyzeComplexity } = require("../src/complexityAnalyzer");
const { getConfigForTier } = require("../src/config/models");

const samplePrompts = [
  "hi",
  "What is the capital of France?",
  "Can you summarize this paragraph for me in one line?",
  "Explain the time complexity of quicksort and compare it with mergesort, including worst-case edge cases.",
  "Design a distributed system architecture for a URL shortener that handles 1 million requests per second, discuss trade-offs, security, and how you'd optimize for scalability. ```js\nfunction test(){}\n```",
];

console.log("=".repeat(70));
console.log("API FORGE — Local Routing Demo (no network / no API key needed)");
console.log("=".repeat(70));

for (const prompt of samplePrompts) {
  const analysis = analyzeComplexity(prompt);
  const config = getConfigForTier(analysis.tier);

  console.log(`\nPrompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`);
  console.log(`  -> Score: ${analysis.score}/100`);
  console.log(`  -> Tier: ${analysis.tier}`);
  console.log(`  -> Routed to: ${config.label} (${config.model})`);
  if (analysis.reasons.length) {
    console.log(`  -> Reasons: ${analysis.reasons.join(" | ")}`);
  }
}

console.log("\n" + "=".repeat(70));
console.log("Done. In production, /v1/chat/completions uses this same logic");
console.log("then actually calls the selected model with your API key.");
console.log("=".repeat(70));
