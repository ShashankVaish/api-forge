# TASK — Context Window Management

**Goal:** never send a request that cannot fit, pick the right-sized model
automatically, and tell the caller exactly what happened.

**Reference:** `docs/context-window.md` (explains *why* in plain language)

**Depends on:** the complexity-analyzer work (`docs/task.md`) — it already
produces `signals.conversationTokens` and `signals.expectedOutputTokens`,
which this work consumes. `tokenEstimator.js` is shared.

**Status:** Phases 0–5 complete — 36/36 tests passing (12 analyzer, 15 context, 9 router). Verified live against Groq. Phase 6 not started.

---

## Research summary (what was checked before designing this)

Limits verified against provider docs on 2026-09-16:

| Model | Context | Max output | Notes |
| --- | --- | --- | --- |
| Groq `openai/gpt-oss-20b` | 131,072 | 65,536 | verified |
| Groq `openai/gpt-oss-120b` | 131,072 | 65,536 | verified |
| Gemini 2.5 Flash | 1,048,576 | 65,536 | verified; supports caching |
| Gemini 2.5 Pro | 1,048,576 | 65,536 | same family limits |
| `mistral-small-latest` | 128k (256k on Small 4) | shared | alias MOVES — stay conservative |
| `mistral-large-latest` | 128,000 | shared | — |
| Claude Haiku 4.5 / Sonnet / Opus | 200,000 | 32k–64k | set output caps LOW: an over-limit `max_tokens` is a hard 400 on Anthropic |

**Rule adopted:** when unsure, UNDER-estimate a window. Under-estimating
only causes unnecessary trimming. Over-estimating causes a failed call.

**Found during live testing (2026-09-16):** the context window is not the
only limit. Groq's free tier rejects any single request over **8,000
tokens** (input + max_tokens) with a 413 — 16× below the model's 131k
window. A correct trim to 73k tokens still failed. This produced design
decision **D11** below and the `maxRequestTokens` per-provider cap.

### Design decisions

These were the open questions. Each has one answer so the code does not
have to re-decide them.

**D1. Where does the logic live?**
A new pure module `backend/src/contextManager.js`, same pattern as the
analyzer: no I/O, no network, fully unit-testable. `modelRouter.js` calls
it. Nothing else changes shape.

**D2. How do we pick a model when the tier's default does not fit?**
Each tier gets an ordered **ladder** of candidates, cheapest first, biggest
window last, in `config/models.js`. The router walks the ladder and takes
the first model that (a) has a provider key configured and (b) fits. The
existing `TIER_CONFIG[tier]` stays as ladder step 1, so nothing that reads
it today breaks.

**D3. Explicit model requests never get silently switched.**
If the caller asked for `groq-fast`, they get `groq-fast`. If it does not
fit, we trim the conversation — we do not quietly upgrade them to Gemini.
Auto-routing is where the ladder applies.

**D4. Fit check uses EXPECTED output; `max_tokens` sent uses the CAP.**
`max_tokens` is a ceiling, not a cost — you only pay for tokens actually
produced. So the fit check reserves what we *expect* the answer to need
(from the analyzer), while the `max_tokens` actually sent is as generous as
the window allows. Reserving the full cap in the fit check would make a 1M
window "need" 65k of headroom for a yes/no question.

**D5. Budget math** (all numbers in `config/contextConfig.js`):
```
paddedInput  = inputTokens * (1 + safetyMargin)      // tokenizer differences, 15%
reserved     = min(expectedOutputTokens, model.maxOutputTokens)
fits         = paddedInput + reserved <= model.contextWindow
maxTokensOut = min(model.maxOutputTokens, model.contextWindow - paddedInput, gatewayCeiling)
```
If `maxTokensOut` would fall below `minOutputFloor` (256), the model is
treated as NOT fitting — an answer with no room to exist is not a fit.

**D6. When nothing fits, trim in this order:**
1. Pick the largest-window candidate that has a key.
2. Keep every `system` message and ALWAYS keep the last user message.
3. Keep the first user message if it fits (it usually holds the task).
4. Walk backwards from the end, adding turns while they fit.
5. If `summarize` is enabled and the dropped turns exceed a threshold,
   summarise them with the **simple** tier model and inject the summary as
   a system message. Fail-open: if that call fails, plain drop.
6. If the last user message ALONE does not fit, throw a `413`-style error
   with the numbers in it. Silently truncating someone's document is worse
   than a clear error.

**D7. Provider errors get normalised.**
Every adapter attaches `err.status` and the router recognises
context-length errors by pattern. On one, it re-plans on the next larger
ladder model — once. `routing.context.retriedOnContextError` says so.

**D8. Truncation is reported, never hidden.**
Every adapter returns `finishReason` normalised to `"stop" | "length" |
"other"`. `routing.truncated === true` when the model hit the cap. The UI
shows a warning.

**D9. Honour `max_tokens` from the request body.**
The endpoint mirrors OpenAI's shape and callers will send it. It becomes an
upper bound on `maxTokensOut`, never a way to exceed the window.

**D11. Plan against the EFFECTIVE window, not the nominal one.**
`effectiveWindow = min(model.contextWindow, provider.maxRequestTokens)`.
Set per provider via env (`GROQ_MAX_REQUEST_TOKENS=8000`); unset means
no cap. Both windows are reported in `routing.context` so the UI can show
"8k (capped from 131k)". Groq's per-request TPM 413 is classified as a
size error (retry bigger); its 429 "try again in 2s" is a timing error and
is not.

**D10. Prompt caching is deferred.**
Anthropic and Gemini support it, but the Anthropic key is unset in this
environment and the change cannot be tested here. Config gets a
`supportsPromptCaching` flag now; the adapter change is Phase 6.

**Optimisations built in from the start:**
- Per-message token counts are computed once and reused by trimming.
- Trimming is a single backwards pass, O(n).
- Summarisation is skipped when dropped content is under
  `summarizeMinDroppedTokens` — never spend a call to summarise "hi".
- The ladder is walked in order and stops at the first fit; no scoring.

---

## Ground rules

1. **Tests first (Phase 0).** `contextManager.js` is pure, so its whole
   behaviour is fixture-testable without a network.
2. **`routing` is a public API.** New fields go into `frontend/lib/api.ts`
   and `routing-card.tsx` in the same change. `ignoreBuildErrors: true`
   hides type errors — check with `npx tsc --noEmit` by hand.
3. **Under-estimate windows.** See the rule above.
4. **Never log prompt text.** Same rule as `routingLogger.js`.
5. **Fail open on the optional parts** (summarisation, logging). Fail
   CLOSED on the hard part: a request that cannot fit must not be sent.

---

## Phase 0 — Safety net

- [x] **C0.1 — `backend/test/contextFixtures.js`**
  Cases for: fits / does not fit / ladder upgrade / explicit model trims
  instead of switching / trim keeps system + last user / first user kept
  when it fits / single message too big → 413 / `max_tokens` from body
  respected / output floor turns a "fit" into a "no fit".
- [x] **C0.2 — `backend/test/contextTest.js`** + npm script
  `test:context`. Same pass/fail table style as `complexityTest.js`.
  **Acceptance:** runs red before Phase 1 (module does not exist yet).

---

## Phase 1 — Limits and config

- [x] **C1.1 — Add limits to every entry in `config/models.js`**
  `contextWindow`, `maxOutputTokens`, `supportsPromptCaching`. Use the
  research table. Comment the source and date on each.
- [x] **C1.2 — Add `TIER_LADDER` to `config/models.js`**
  ```js
  simple:   ["simple",   "geminiFlash"]
  moderate: ["moderate", "geminiFlash"]
  complex:  ["complex",  "geminiPro"]
  ```
  Export `getLadderForTier(tier)` → array of config objects.
- [x] **C1.3 — Create `config/contextConfig.js`**
  `safetyMargin` (0.15), `minOutputFloor` (256), `gatewayMaxOutputTokens`
  (8192, env-overridable), `trim.keepFirstUserMessage` (true),
  `summarize.enabled` (env `CONTEXT_SUMMARIZE`, default on),
  `summarize.minDroppedTokens` (200), `summarize.maxSummaryTokens` (400),
  `summarize.tier` ("simple").

---

## Phase 2 — The context manager (pure)

- [x] **C2.1 — `backend/src/contextManager.js`: `fits()` and `budgetFor()`**
  Implements D5. Returns `{ fits, paddedInput, reserved, maxTokensOut }`.
- [x] **C2.2 — `selectModel()`**
  Walks candidates (D2). Skips models without a provider key. Returns the
  first fit, or `null` plus the largest-window candidate to trim for.
- [x] **C2.3 — `trimMessages()`**
  Implements D6 steps 2–4 and 6. Returns `{ messages, dropped, droppedTokens }`.
  Throws `ContextTooLargeError` (with `.status = 413` and the numbers) when
  the last user message alone cannot fit.
- [x] **C2.4 — `planContext()`** — the one function the router calls
  Input: `{ messages, candidates, expectedOutputTokens, requestedMaxTokens,
  allowModelSwitch }`. Output:
  ```js
  {
    model,            // chosen config
    messages,         // possibly trimmed
    maxTokensOut,
    context: {
      inputTokens, reservedOutputTokens, contextWindow, utilization,
      upgradedModel, trimmed: { droppedMessages, droppedTokens, strategy } | null,
    },
    droppedMessages,  // raw, for the summariser
  }
  ```
  **Acceptance:** `npm run test:context` fully green.

---

## Phase 3 — Providers

- [x] **C3.1 — Every adapter accepts `options.maxOutputTokens`**
  Field names differ: Anthropic + OpenAI-compatible use `max_tokens`,
  Gemini uses `generationConfig.maxOutputTokens`. Remove the hardcoded
  `1024` from `anthropicProvider.js`.
- [x] **C3.2 — Every adapter returns `finishReason`** (D8)
  Anthropic `stop_reason` (`max_tokens` → length), OpenAI-compatible
  `finish_reason` (`length` → length), Gemini `finishReason`
  (`MAX_TOKENS` → length). Everything else → `"stop"` or `"other"`.
- [x] **C3.3 — Every adapter attaches `err.status`** on non-OK responses.
- [x] **C3.4 — `isContextLengthError(err)`** in `contextManager.js`
  Pattern: `context.{0,20}length|too long|token count|maximum context|
  prompt is too long|exceeds the .{0,20}limit|INVALID_ARGUMENT.*token`.

---

## Phase 4 — Router integration

- [x] **C4.1 — `modelRouter.js` uses `planContext()`** before calling
  the provider. Candidates = ladder for auto, single model for explicit.
- [x] **C4.2 — Summarise dropped turns** (D6 step 5) when enabled and
  above threshold. Uses the simple tier's provider + key. Fail-open.
- [x] **C4.3 — Retry on context-length error** (D7). One re-plan on the
  next larger candidate. Set `routing.context.retriedOnContextError`.
- [x] **C4.4 — `routing.truncated`** from `finishReason`.
- [x] **C4.5 — Dependency injection for tests**
  `routeRequest(params, deps = { providers, providerKeys })` so the retry
  and summarise paths can be tested with a fake provider, no network.
- [x] **C4.6 — `server.js`**: pass `max_tokens` from the body through;
  honour `err.status` (413 for too-large) instead of always 502.
- [x] **C4.7 — `routingLogger.js`**: log `context.utilization`,
  `context.trimmed`, `context.upgradedModel`, `truncated`.

---

## Phase 5 — Frontend

- [x] **C5.1 — `RoutingInfo`** gains `context` and `truncated`.
- [x] **C5.2 — `routing-card.tsx`** shows: a context-utilisation bar
  ("~12k / 131k"), a "trimmed N older messages" note, a "switched to
  bigger model" note, and a visible warning when `truncated`.
- [x] **C5.3 — `npx tsc --noEmit`** clean.

---

## Phase 6 — Later

- [ ] **C6.1** Prompt caching for Anthropic (`cache_control` on the system
  prompt) and Gemini, gated on `supportsPromptCaching`. Needs a key to test.
- [ ] **C6.2** Exact token counts via `gpt-tokenizer` when a request lands
  within 5% of a window — only then, to keep the hot path free.
- [ ] **C6.3** Map-reduce for single documents larger than every window.

---

## Risks

| Risk | Handling |
| --- | --- |
| A window value is too HIGH and calls fail | Under-estimate rule + the retry path in C4.3 catches it at runtime |
| Summarisation adds latency to every long chat | Threshold + fail-open; can be disabled with `CONTEXT_SUMMARIZE=off` |
| Trimming silently loses the task statement | First user message is kept whenever it fits (D6 step 3) |
| Gemini has known key issues (README) | The ladder skips any model whose provider key is missing; Gemini only used when configured |
| Explicit-model users surprised by trimming | Reported in `routing.context.trimmed`; never hidden |

---

## Suggested order

**Session 1:** Phase 0 → 1 → 2. Pure code, fully tested, no network.
**Session 2:** Phase 3 → 4. Wiring; test with fake provider then live.
**Session 3:** Phase 5.
