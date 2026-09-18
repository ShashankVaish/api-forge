/**
 * contextManager.js
 *
 * Decides whether a request FITS a model's context window before we send
 * it, picks a bigger model when it does not, and trims the conversation
 * when nothing fits. Pure: no I/O, no network — the router does the calls.
 *
 * Why this exists: the router picks a model at runtime from a complexity
 * score, so the same prompt can land on a 131k window or a 1M one. Without
 * a fit check, a big paste routed to the small model fails upstream and
 * surfaces as a fake "provider unreachable" fallback. Size has to be an
 * INPUT to routing, not an error discovered afterwards.
 *
 * Budget math (D5 in docs/task-context-window.md):
 *
 *   paddedInput  = ceil(inputTokens * (1 + safetyMargin))
 *   reserved     = min(expectedOutputTokens, model.maxOutputTokens)
 *   fits         = paddedInput + reserved <= contextWindow
 *                  AND (contextWindow - paddedInput) >= minOutputFloor
 *   maxTokensOut = min(model cap, room left, gateway ceiling, caller's max_tokens)
 *
 * The fit check reserves what we EXPECT the answer to need; the max_tokens
 * we actually send is as generous as the window allows. max_tokens is a
 * ceiling, not a cost.
 */

const C = require("./config/contextConfig");
const providerKeys = require("./config/providerKeys");
const { estimateMessageTokens, estimateTokens } = require("./tokenEstimator");

// ── errors ─────────────────────────────────────────────────────────────

class ContextTooLargeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ContextTooLargeError";
    this.status = 413;
    Object.assign(this, details);
  }
}

class NoEligibleModelError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "NoEligibleModelError";
    this.status = 503;
    Object.assign(this, details);
  }
}

// ── budget ─────────────────────────────────────────────────────────────

function padInput(tokens) {
  return Math.ceil(tokens * (1 + C.safetyMargin));
}

/**
 * The window we actually plan against: the model's context window, or the
 * provider's per-request cap if that is smaller (Groq free tier: 8k vs a
 * 131k window). Whichever limit will be enforced first is the real one.
 */
function effectiveWindow(model) {
  const cap = model.maxRequestTokens;
  return Number.isFinite(cap) && cap > 0
    ? Math.min(model.contextWindow, cap)
    : model.contextWindow;
}

/**
 * @returns {{ fits: boolean, paddedInput: number, reserved: number,
 *             room: number, maxTokensOut: number }}
 */
function budgetFor(model, inputTokens, expectedOutputTokens = 0, requestedMaxTokens = null) {
  const window = effectiveWindow(model);
  const paddedInput = padInput(inputTokens);
  const room = window - paddedInput;
  const reserved = Math.min(expectedOutputTokens || 0, model.maxOutputTokens);

  let maxTokensOut = Math.min(model.maxOutputTokens, room, C.gatewayMaxOutputTokens);
  if (Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0) {
    maxTokensOut = Math.min(maxTokensOut, requestedMaxTokens);
  }
  maxTokensOut = Math.max(0, Math.floor(maxTokensOut));

  const fits = paddedInput + reserved <= window && room >= C.minOutputFloor;

  return { fits, paddedInput, reserved, room, maxTokensOut, window };
}

// ── model selection ────────────────────────────────────────────────────

function defaultHasKey(provider) {
  return Boolean(providerKeys[provider]);
}

/**
 * Walks the candidate ladder in order and returns the first model that has
 * a provider key AND fits. If none fits, returns the largest-window
 * eligible model with `fits: false` so the caller can trim for it.
 */
function selectModel({ candidates, inputTokens, expectedOutputTokens, requestedMaxTokens, hasKey = defaultHasKey }) {
  const eligible = candidates.filter((c) => hasKey(c.provider));
  if (eligible.length === 0) {
    throw new NoEligibleModelError(
      "No candidate model has a provider API key configured on the server. " +
        `Candidates: ${candidates.map((c) => `${c.provider}/${c.model}`).join(", ")}.`,
      { candidates: candidates.map((c) => c.key) },
    );
  }

  for (const model of eligible) {
    const budget = budgetFor(model, inputTokens, expectedOutputTokens, requestedMaxTokens);
    if (budget.fits) {
      return { model, budget, fits: true, upgraded: model !== candidates[0] };
    }
  }

  const largest = eligible.reduce((a, b) =>
    effectiveWindow(b) > effectiveWindow(a) ? b : a,
  );
  return {
    model: largest,
    budget: budgetFor(largest, inputTokens, expectedOutputTokens, requestedMaxTokens),
    fits: false,
    upgraded: largest !== candidates[0],
  };
}

// ── trimming ───────────────────────────────────────────────────────────

/**
 * Sliding-window trim (D6). Always keeps every system message and the last
 * user message; keeps the first user message if it fits (it usually holds
 * the task); then walks backwards from the end adding turns while they
 * fit, stopping at the first that does not so the kept history stays
 * contiguous.
 *
 * Throws ContextTooLargeError if the last user message alone cannot fit —
 * silently truncating someone's document is worse than a clear error.
 */
function trimMessages({ messages, model, expectedOutputTokens, requestedMaxTokens, tokenCounts }) {
  const counts = tokenCounts || messages.map(estimateMessageTokens);
  const fitsWith = (t) => budgetFor(model, t, expectedOutputTokens, requestedMaxTokens).fits;

  const keep = new Set();
  let total = 0;
  const add = (i) => { keep.add(i); total += counts[i]; };

  messages.forEach((m, i) => { if (m.role === "system") add(i); });

  let lastUserIdx = -1;
  let firstUserIdx = -1;
  messages.forEach((m, i) => {
    if (m.role !== "user") return;
    if (firstUserIdx === -1) firstUserIdx = i;
    lastUserIdx = i;
  });
  if (lastUserIdx === -1) lastUserIdx = messages.length - 1;
  if (!keep.has(lastUserIdx)) add(lastUserIdx);

  if (!fitsWith(total)) {
    const b = budgetFor(model, total, expectedOutputTokens, requestedMaxTokens);
    throw new ContextTooLargeError(
      `The latest message is too large for any available model: ~${counts[lastUserIdx]} tokens ` +
        `(+${total - counts[lastUserIdx]} of system prompt) against a ${b.window}-token limit ` +
        `on ${model.label}` +
        (b.window < model.contextWindow ? " (provider per-request cap, below the model's window)" : "") +
        `, leaving ${Math.max(0, b.room)} tokens for the answer. ` +
        "Shorten the message or split it into parts.",
      {
        inputTokens: total,
        paddedInput: b.paddedInput,
        contextWindow: b.window,
        nominalContextWindow: model.contextWindow,
        model: model.key,
      },
    );
  }

  if (C.trim.keepFirstUserMessage && firstUserIdx !== -1 && !keep.has(firstUserIdx)) {
    if (fitsWith(total + counts[firstUserIdx])) add(firstUserIdx);
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    if (keep.has(i)) continue;
    if (fitsWith(total + counts[i])) add(i);
    else break;
  }

  const kept = [];
  const dropped = [];
  let droppedTokens = 0;
  messages.forEach((m, i) => {
    if (keep.has(i)) kept.push(m);
    else { dropped.push(m); droppedTokens += counts[i]; }
  });

  return { messages: kept, dropped, droppedTokens, inputTokens: total };
}

// ── summarisation helpers (pure; the router makes the call) ───────────

/**
 * Builds the messages array for the summariser. Caps the dropped text at
 * summarize.maxInputTokens by taking the head and tail — enough to write
 * a useful summary without the summariser itself blowing its window.
 */
function buildSummaryRequest(dropped, maxInputTokens = C.summarize.maxInputTokens) {
  const lines = dropped.map((m) => `${m.role.toUpperCase()}: ${m.content}`);
  let transcript = lines.join("\n\n");

  const cap = Math.max(400, maxInputTokens) * 4; // tokens -> chars
  if (transcript.length > cap) {
    const half = Math.floor(cap / 2);
    transcript =
      transcript.slice(0, half) +
      "\n\n[... middle of conversation omitted ...]\n\n" +
      transcript.slice(-half);
  }

  return [
    {
      role: "system",
      content:
        "You compress conversation history. Write a concise summary of the " +
        "transcript below, preserving: the user's goal, any constraints or " +
        "preferences they stated, decisions already made, and facts or code " +
        "that later turns depend on. Plain prose, no preamble.",
    },
    { role: "user", content: transcript },
  ];
}

/** Inserts the summary as a system message right after any existing ones. */
function injectSummary(messages, summaryText) {
  const note = {
    role: "system",
    content: `Summary of earlier conversation (older turns were trimmed to fit the context window):\n${summaryText}`,
  };
  const lastSystem = messages.reduce((idx, m, i) => (m.role === "system" ? i : idx), -1);
  const out = [...messages];
  out.splice(lastSystem + 1, 0, note);
  return { messages: out, summaryTokens: estimateMessageTokens(note) };
}

// ── error classification ───────────────────────────────────────────────

const CONTEXT_ERROR_RE =
  /context.{0,30}length|context_length_exceeded|too long|token count|maximum context|exceeds the maximum|reduce the length|maximum number of tokens|input is too large|prompt is too large|request too large|reduce your message size/i;

/**
 * True if a provider error means "this request is too big for this model
 * or provider" (D7). Includes Groq's per-request TPM 413 — switching to a
 * bigger provider is the right response to that too. A plain 429 "try
 * again in 2s" rate limit is NOT matched: that is about timing, not size.
 */
function isContextLengthError(err) {
  return CONTEXT_ERROR_RE.test(String(err?.message || err || ""));
}

// ── the one function the router calls ─────────────────────────────────

/**
 * @param {object} p
 * @param {Array}   p.messages
 * @param {Array}   p.candidates             ordered model configs (ladder)
 * @param {number}  p.expectedOutputTokens   from the complexity analyzer
 * @param {number}  [p.requestedMaxTokens]   `max_tokens` from the request body
 * @param {boolean} [p.allowModelSwitch=true] false for explicit model requests (D3)
 * @param {Function}[p.hasKey]               (provider) => boolean, injectable for tests
 */
function planContext({
  messages,
  candidates,
  expectedOutputTokens = 0,
  requestedMaxTokens = null,
  allowModelSwitch = true,
  hasKey = defaultHasKey,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new NoEligibleModelError("No candidate models were supplied to planContext().");
  }

  // Per-message counts computed once, reused by trimming.
  const tokenCounts = messages.map(estimateMessageTokens);
  const originalInputTokens = tokenCounts.reduce((a, b) => a + b, 0);

  const ladder = allowModelSwitch ? candidates : [candidates[0]];
  const sel = selectModel({
    candidates: ladder,
    inputTokens: originalInputTokens,
    expectedOutputTokens,
    requestedMaxTokens,
    hasKey,
  });

  let finalMessages = messages;
  let inputTokens = originalInputTokens;
  let budget = sel.budget;
  let trimmed = null;
  let droppedMessages = [];

  if (!sel.fits) {
    const t = trimMessages({
      messages,
      model: sel.model,
      expectedOutputTokens,
      requestedMaxTokens,
      tokenCounts,
    });
    finalMessages = t.messages;
    inputTokens = t.inputTokens;
    droppedMessages = t.dropped;
    budget = budgetFor(sel.model, inputTokens, expectedOutputTokens, requestedMaxTokens);
    trimmed = {
      droppedMessages: t.dropped.length,
      droppedTokens: t.droppedTokens,
      strategy: "sliding-window",
    };
  }

  return {
    model: sel.model,
    messages: finalMessages,
    maxTokensOut: budget.maxTokensOut,
    droppedMessages,
    context: {
      inputTokens,
      originalInputTokens,
      reservedOutputTokens: budget.reserved,
      contextWindow: budget.window,                  // what decisions used
      nominalContextWindow: sel.model.contextWindow,  // the model's own limit
      utilization: Number((budget.paddedInput / budget.window).toFixed(2)),
      upgradedModel: sel.upgraded,
      trimmed,
      retriedOnContextError: false,
    },
  };
}

module.exports = {
  planContext,
  budgetFor,
  effectiveWindow,
  selectModel,
  trimMessages,
  buildSummaryRequest,
  injectSummary,
  isContextLengthError,
  ContextTooLargeError,
  NoEligibleModelError,
  estimateTokens,
};
