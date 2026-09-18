# TASK — Complexity Analyzer Rebuild

**Goal:** make `backend/src/complexityAnalyzer.js` route prompts correctly,
then make it tunable.

**Reference:** `docs/complexity-analyzer.md` (explains *why* for each task)

**Status:** Phases 0-4 complete — 12/12 fixtures passing. Phase 5 not started.

---

## Ground rules

Read these before touching code.

1. **Write the tests first (Phase 0).** Every task below has an acceptance
   test. Without a test file you cannot tell if a change fixed one case and
   broke three others.
2. **The `routing` object is a public API.** It is returned to callers and
   typed in `frontend/lib/api.ts` (`RoutingInfo`) and rendered by
   `frontend/components/routing-card.tsx`. If you add or rename a field, you
   must update both, or the UI silently shows nothing.
3. **Do not rename the tier values.** `usageTracker.js` does
   `TIER_CONFIG[tier].approxCostPer1kTokens` with no guard. A tier value
   outside `simple` / `moderate` / `complex` will crash `/v1/stats`.
4. **Keep `reasons[]` working.** It is the feature that makes routing
   explainable. Every new signal must push a human-readable reason.
5. **No network calls in the analyzer.** The entire value of this design is
   that scoring is free and instant. Local libraries only.

---

## Phase 0 — Safety net (do this first)

- [x] **T0.1 — Create `backend/test/complexityFixtures.js`**

  Export an array of test cases: `{ prompt, expectedTier, note }`.
  Start with the table in **Test fixtures** below.

- [x] **T0.2 — Create `backend/test/complexityTest.js`**

  Loop the fixtures, run `analyzeComplexity`, print a pass/fail table, and
  `process.exit(1)` if any case fails.

  Use Node's built-in `node:test` + `node:assert` — no new dependency needed.

- [x] **T0.3 — Add the npm script**

  In `backend/package.json`: `"test:complexity": "node test/complexityTest.js"`

  **Acceptance:** `npm run test:complexity` runs and reports **5 failures**
  (the known bugs). That red baseline is the point — Phase 1 turns it green.

---

## Phase 1 — Bug fixes

Small, safe changes. No change to the return shape, so nothing else breaks.

- [x] **T1.1 — Gate the greeting shortcut on message length**

  **File:** `complexityAnalyzer.js`, the `isTrivial` check
  **Change:** only allow the early return when `words <= 12`.
  **Acceptance:** `"Hi, can you design a distributed rate limiter…"` →
  `complex`. `"hi"` → still `simple`.

- [x] **T1.2 — Match whole words only**

  **File:** `complexityAnalyzer.js`, `keywordHits()`
  **Change:** precompile `HIGH_COMPLEXITY_KEYWORDS` into `\b`-anchored
  regexes once at module load. Escape regex characters in each keyword.
  **Acceptance:** `"this improved approach is approved"` → 0 keyword hits.
  `"prove this theorem"` → 1 hit.

- [x] **T1.3 — Score code by size, not presence**

  **File:** `complexityAnalyzer.js`, `countCodeBlocks()`
  **Change:**
  - Count *lines inside* fences, not fence pairs.
  - Handle an unclosed fence (currently returns `0.5`).
  - Detect code with no fences: lines ending in `;` `{` `}`, or the tokens
    `function` `=>` `def ` `class ` `import ` `SELECT `.
  **Acceptance:** a 1-line snippet scores lower than a 50-line paste. A
  fence-less 30-line paste is detected.

**Phase 1 done when:** `npm run test:complexity` is fully green on the
Phase 1 fixtures.

---

## Phase 2 — Two-axis scoring

The real rework. **Breaking change** — do the frontend task in the same PR.

- [x] **T2.1 — Replace word counting with token estimation**

  **File:** new `backend/src/tokenEstimator.js`
  **Change:** export `estimateTokens(text)`. Start with the
  characters-per-token heuristic (4 for prose, 3 for code); leave a clear
  comment that `gpt-tokenizer` is the upgrade path.
  **Why separate file:** `docs/context-window.md` needs this exact function.

- [x] **T2.2 — Split the score into `difficulty` and `size`**

  **File:** `complexityAnalyzer.js`
  **Change:** return `{ difficulty, size, score, tier, confidence, reasons }`.

  - `difficulty` — how much reasoning is needed (keywords, code, task type)
  - `size` — how many tokens flow in and out (length, output-length signals)
  - `score` — keep it, derived from both, so `RoutingInfo.complexityScore`
    and the existing UI keep working

  **Acceptance:** a 40k-token document with "summarize this" returns **high
  size, low difficulty**.

- [x] **T2.3 — Detect long-answer requests**

  Keywords: `write` `generate` `implement` `essay` `article` `full`
  `complete` `entire`. Number patterns: `\d+\s*(words|lines|items|examples|paragraphs)`, `list \d+`.
  Feeds **size**.
  **Acceptance:** `"Write a complete 2000-word essay"` → `complex`.

- [x] **T2.4 — Detect short-answer requests**

  Keywords: `briefly` `concisely` `in one sentence` `tl;dr` `yes or no`
  `just the code` `one word`. Subtracts from **size**.
  **Acceptance:** `"explain quantum computing in one sentence"` scores lower
  than `"explain quantum computing in full detail"`.

- [x] **T2.5 — Add the task-type table**

  `transform` (translate/summarize/rewrite/extract) → difficulty **down**.
  `reason` (why/prove/derive/debug/root cause) → difficulty **up**.
  `generate` (write/implement/build/design) → size **up**.
  **Acceptance:** a 500-word translation request does **not** reach
  `complex`.

- [x] **T2.6 — Score the whole conversation, not just the last message**

  **File:** `modelRouter.js` passes `messages`; analyzer sums tokens across
  all of them instead of using `messages.length`.
  **Acceptance:** 6 one-word messages score lower than 6 long messages.

- [x] **T2.7 — Update `modelRouter.js` to use both axes**

  Put the new fields into the returned `routing` object.

- [x] **T2.8 — Update the frontend types and UI**

  **Files:** `frontend/lib/api.ts` (`RoutingInfo`),
  `frontend/components/routing-card.tsx`
  **Change:** add `difficulty`, `size`, `confidence`. Show difficulty and
  size as two small bars instead of one score.
  ⚠️ `next.config.mjs` has `ignoreBuildErrors: true`, so a type mismatch
  here will **not** fail the build. Check it by hand.

---

## Phase 3 — Conversation awareness

- [x] **T3.1 — Sticky tier**

  **Problem:** `"continue"` scores 0 and drops from `complex` to `simple`
  mid-conversation.
  **Change:** rule → `final = max(current_tier, previous_tier - 1 step)`.
  **Where to store it:** simplest is to derive it from the conversation — if
  any earlier turn looks complex, set a floor. A `conversationId` +
  in-memory map is cleaner but adds state; decide before building.
  **Acceptance:** `["<hard architecture question>", "<answer>", "continue"]`
  → the third turn does **not** return `simple`.

- [x] **T3.2 — Confidence and boundary handling**

  **Change:** return `confidence` based on distance from the nearest cutoff.
  Round borderline scores (within ~3 points) **up** a tier.
  **Acceptance:** score 54 and score 55 pick the same model.

---

## Phase 4 — Tunable and measurable

- [x] **T4.1 — Extract weights to config**

  **File:** new `backend/src/config/complexityWeights.js`
  Move every number — all `score +=` values and the `25` / `55` cutoffs.
  Allow env overrides for the two cutoffs.
  **Acceptance:** changing a weight in config changes routing, with no edit
  to `complexityAnalyzer.js`.

- [x] **T4.2 — Log every routing decision**

  **File:** new `backend/src/routingLogger.js`, called from `modelRouter.js`
  Append JSONL: `{ ts, promptHash, difficulty, size, tier, provider, model,
  latencyMs, inputTokens, outputTokens, usedFallback }`.
  ⚠️ **Log a SHA-256 hash of the prompt, never the prompt text.**
  **Acceptance:** 10 requests produce 10 lines in `data/routing-log.jsonl`.

---

## Phase 5 — Later (do not start until 0–4 are done)

- [ ] **T5.1** Cascade routing — try cheap, check the reply, escalate if bad
- [ ] **T5.2** Shadow sampling — 1% of traffic calls both models, save both
- [ ] **T5.3** Local classifier trained on the T5.2 data
- [ ] **T5.4** `routing_preference: "cost" | "balanced" | "quality"` request param

---

## Test fixtures

Use these in T0.1. The first five are the currently-failing cases.

| # | Prompt | Expected | Tests |
| --- | --- | --- | --- |
| 1 | `Hi, can you design a distributed rate limiter with consistent hashing and walk me through the tradeoffs?` | `complex` | T1.1 |
| 2 | `Write a complete 2000-word technical essay on database indexing.` | `complex` | T2.3 |
| 3 | `prove that this improved approach is approved by the team` | `simple` | T1.2 |
| 4 | `Refactor this:` + 1-line code block | `simple` | T1.3 |
| 5 | `[hard question], [answer], "continue"` | not `simple` | T3.1 |
| 6 | `hi` | `simple` | T1.1 regression |
| 7 | `what is a monad?` | `simple` | shortcut still works |
| 8 | `Translate this 500-word paragraph to French: …` | `simple`/`moderate` | T2.5 |
| 9 | `explain quantum computing in one sentence` | `simple` | T2.4 |
| 10 | `Design a multi-region database failover strategy and compare the tradeoffs` | `complex` | regression |
| 11 | 300-line code paste, no fences, `find the bug` | `complex` | T1.3 |
| 12 | 40,000-word document + `summarize this` | high size, low difficulty | T2.2 |

---

## Risks

| Risk | Where | Handling |
| --- | --- | --- |
| `/v1/stats` crashes | `usageTracker.js` — `TIER_CONFIG[tier]` is unguarded | Do not add new tier values. Add a fallback in `getStats()` while you are in there. |
| Frontend silently breaks | `ignoreBuildErrors: true` hides type errors | Check the routing card by hand after T2.8. |
| Everything gets more expensive | New signals mostly push scores **up** | After Phase 2, run all 12 fixtures and confirm the tier spread is still balanced — not 10 out of 12 landing on `complex`. |
| Prompt text leaks into logs | T4.2 | Hash only. Never log `content`. |

---

## Suggested order

**Session 1:** Phase 0 + Phase 1 — red baseline, then green. ~2 hours.
**Session 2:** Phase 2 — the rework, frontend included. ~half a day.
**Session 3:** Phase 3 + Phase 4. ~half a day.
