# Context Window — What It Is and How to Handle It Across Providers

**Code this affects:** `backend/src/modelRouter.js`,
`backend/src/config/models.js`, `backend/src/providers/*.js`

---

## 1. What a context window is

An AI model has **no memory**. It does not remember your last message.

Every time you call it, you must send the **whole conversation again** —
system prompt, all old messages, and the new question.

The **context window** is the maximum amount of text the model can look at
in one single call.

Think of it as a **desk**. Everything has to fit on the desk at once:

```
[ system prompt ] + [ all old messages ] + [ new question ] + [ space for the answer ]
└──────────────────────── must all fit on the desk ────────────────────────┘
```

Two important points people often miss:

1. **The answer also takes space on the desk.** If the model has a 128,000
   token desk and your input uses 127,000, there is almost no room left for
   it to write a reply.
2. **If it does not fit, the call fails.** You do not get a shorter answer.
   You get an error, and you may still be charged for the attempt.

### What is a token?

A token is a piece of a word. Rough guide for English:

| Text | Approx tokens |
| --- | --- |
| 1 token | about 4 characters |
| 1 word | about 1.3 tokens |
| 1 page of text | about 500 tokens |
| Code | denser — closer to 3 characters per token |

So "context window = 128,000 tokens" means roughly 90,000 English words, or
about 250 pages.

---

## 2. Why this matters for API Forge specifically

This is a bigger problem for a **router** than for a normal app.

A normal app picks one model and knows its limit. API Forge picks the model
**at runtime**, based on a complexity score. So the same prompt can land on
a model with a small desk or a big desk depending on its score.

**Right now `modelRouter.js` never checks whether the text fits.**

Here is what happens today if a user pastes a 300,000-token document:

1. The complexity analyzer scores it.
2. The router picks, say, the Groq model (about 131,000 token desk).
3. Groq rejects the call because the input is too big.
4. Your `try/catch` catches the error and returns the fallback message.
5. The user gets `[FALLBACK RESPONSE — … was unreachable]` and no answer.

The fallback makes it *look* like a provider outage, when really it was a
size problem you could have avoided by picking a different model.

Worse, it is **inconsistent**. If the score had been slightly different and
the router had picked Gemini (about 1,000,000 token desk), the exact same
prompt would have worked fine.

**The fix in one sentence:** size must be an *input* to routing, not an
error you discover afterwards.

---

## 3. Every provider is different

Two things change between providers: **how big the desk is**, and **how they
count tokens**.

### Approximate limits

| Provider | Model | Input window | Max answer size |
| --- | --- | --- | --- |
| Groq | `openai/gpt-oss-20b` | ~131,000 | ~33,000 |
| Groq | `openai/gpt-oss-120b` | ~131,000 | ~33,000 |
| Mistral | `mistral-small-latest` | ~128,000 | ~128,000 shared |
| Mistral | `mistral-large-latest` | ~128,000 | ~128,000 shared |
| Anthropic | Claude Haiku / Sonnet / Opus | ~200,000 | tens of thousands |
| Google | Gemini 2.5 Flash / Pro | ~1,000,000 | ~65,000 |

> ⚠️ **Check these before shipping.** Providers change limits often, and
> some raise them for specific accounts or beta flags. Treat this table as
> "roughly right today", and put the real numbers in `config/models.js`
> where you can update them in one place.

The practical takeaway: **Gemini has by far the biggest desk.** If a user
sends something enormous, Gemini is often the only option that can take it
at all — regardless of how hard the question is.

### The counting problem

Every provider chops text into tokens **differently**. The same paragraph
might be 1,000 tokens on one provider and 1,150 on another.

So you cannot count once and trust that number everywhere. Two rules:

1. Use a **local estimate** for routing decisions (fast, free).
2. Always leave a **safety margin** of 10–15%, because your estimate will be
   wrong in one direction or the other.

Anthropic and Gemini both have exact token-counting endpoints, but those are
network calls. Use them only when you are close to a limit and need
certainty — not on every request.

---

## 4. Step-by-step fix

### Step 1 — write the limits down

`config/models.js` currently has no size information at all. Add it:

```js
simple: {
  provider: "groq",
  model: "openai/gpt-oss-20b",
  label: "Groq GPT-OSS 20B (fast)",
  approxCostPer1kTokens: 0.000375,
  contextWindow: 131072,     // total desk size
  maxOutputTokens: 32768,    // most it can write in one reply
},
```

This one change makes every step below possible.

### Step 2 — estimate the size before routing

A simple estimator, no library needed:

```js
function estimateTokens(messages) {
  const text = messages.map((m) => m.content || "").join("\n");
  // Code is denser than prose, so use a smaller divisor when we see code.
  const looksLikeCode = /```|function |=>|class |import |SELECT /i.test(text);
  const divisor = looksLikeCode ? 3 : 4;
  return Math.ceil(text.length / divisor);
}
```

For better accuracy later, swap this for the `gpt-tokenizer` package. It
runs locally, so it stays fast.

### Step 3 — filter first, then rank

This is the key idea. Routing becomes **two steps instead of one**:

```
1. SIZE decides which models are even POSSIBLE   (a hard filter)
2. DIFFICULTY decides which of those is BEST     (your existing score)
```

In code:

```js
const needed = estimateTokens(messages) + reservedForAnswer + margin;

const candidates = Object.values(TIER_CONFIG).filter(
  (m) => m.contextWindow >= needed,
);

if (candidates.length === 0) {
  // nothing fits — go to Step 5 (shrink the conversation)
}

// now pick from `candidates` using the complexity tier, as you do today
```

Notice how this connects to the complexity doc: the **size score** from
`docs/complexity-analyzer.md` (Fix 4) is exactly what drives this filter.
The two documents describe two halves of one routing decision.

### Step 4 — reserve room for the answer

Never fill the desk to 100%. Always subtract the space the reply will need:

```js
const reservedForAnswer = 4000;              // or use the size score
const margin = Math.ceil(inputTokens * 0.15); // tokenizer differences
const needed = inputTokens + reservedForAnswer + margin;
```

If someone asks for a 2000-word essay, reserve more. If they ask a yes/no
question, reserve less.

### Step 5 — if nothing fits, shrink the conversation

When even the biggest model cannot take it, you must make the input smaller.
Five ways, from easiest to most advanced:

**A. Sliding window (easiest)**

Keep the system prompt plus the last N messages. Drop the rest.

- ✅ Ten lines of code
- ❌ The model forgets the beginning of the conversation

**B. Keep the first and the last**

The first message usually contains the actual task ("you are a Python
tutor", "here is my codebase"). The middle is usually less important. So
keep the first message and the most recent ones, and drop the middle.

- ✅ Still simple, noticeably better than A

**C. Summarize the old part using your own cheap model** ⭐

When the conversation passes about 70% of the window, take the oldest
messages, send them to your **cheapest tier**, and replace them with a short
summary.

This is the best fit for API Forge, because you already have a cheap tier
sitting right there. You can describe it as: *"API Forge uses its own cheap
models to compress context for its expensive models."* That is a genuinely
good line for a README or an interview.

- ✅ Keeps the meaning of old messages
- ❌ Costs one extra small call, and adds some latency

**D. Split and combine (map-reduce)**

For one giant document that will never fit: cut it into chunks, run the
cheap model on each chunk, then combine the results with one final call.

- ✅ Handles input of any size
- ❌ More complex, and the model never sees the whole thing at once

**E. Search instead of send (RAG)**

Store the document in a vector database. When a question comes in, find only
the 5 most relevant pieces and send just those.

- ✅ Cheapest for very large or repeated documents
- ❌ Needs a vector database — a real project on its own

**Suggested plan:** build **A** now, upgrade to **C** when you want a strong
feature to show off.

### Step 6 — recognize "too long" errors properly

Every provider words this error differently:

| Provider | Roughly what it says |
| --- | --- |
| Groq / Mistral | `context_length_exceeded`, "maximum context length" |
| Anthropic | "prompt is too long" |
| Gemini | `INVALID_ARGUMENT`, token count exceeds limit |

Right now all of these fall into the same generic fallback message. Instead,
detect them and **retry on a bigger-window model** before giving up:

```js
function isContextLengthError(err) {
  return /context.{0,20}length|too long|token count|maximum context/i.test(
    err.message,
  );
}
```

A retry that succeeds is a much better user experience than a fallback
message that explains nothing.

---

## 5. Output tokens — the part people forget

The *answer* size is set separately from the context window, and your
providers currently handle this inconsistently:

| File | What it does now | Problem |
| --- | --- | --- |
| `anthropicProvider.js` | `max_tokens: 1024` hardcoded | Every Claude answer is cut off at ~750 words, no matter what |
| `groqProvider.js` | not set | Uses Groq's default, which you do not control |
| `mistralProvider.js` | not set | Same |
| `geminiProvider.js` | not set | Same |

Two things to fix:

1. **Make it consistent.** Pass a `maxOutputTokens` value through all four
   adapters. Note the field names differ: Anthropic uses `max_tokens` (and
   *requires* it), OpenAI-compatible APIs like Groq and Mistral use
   `max_tokens` (optional), and Gemini uses
   `generationConfig.maxOutputTokens`.

2. **Make it smart.** Use the size score from the complexity analyzer. A
   yes/no question does not need room for 4000 tokens; an essay request
   does. Reserving the right amount frees up desk space for input.

Also watch for **truncated answers**. Every provider tells you why it
stopped — Anthropic in `stop_reason`, the OpenAI-compatible ones in
`finish_reason`. If it says the limit was hit, the user got a half-finished
answer and should probably know. None of your adapters read this field
today.

---

## 6. Prompt caching (a bonus saving)

In a chat, you send almost the same text every turn — the same system
prompt, the same history, plus one new message. You pay for all of it, every
single time.

Anthropic and Gemini both let you mark a repeated prefix as **cached**.
After the first call, re-reading that cached part costs far less.

This pairs perfectly with strategy **C** above: summarize the old
conversation, mark the summary as cached, and long chats get much cheaper.

Groq and Mistral do not offer the same feature, so this would be a
provider-specific optimization — worth putting behind a
`supportsPromptCaching: true` flag in `config/models.js`.

---

## 7. Provider gotchas, in short

| Provider | Things to watch |
| --- | --- |
| **Groq** | Smallest window of your four. Also has strict per-minute token limits, so a big request can be rejected for rate reasons even when it fits. |
| **Mistral** | Input and output share one budget. A long input directly shrinks the possible answer. |
| **Anthropic** | `max_tokens` is **required** — you cannot leave it out. Largest window after Gemini. |
| **Gemini** | By far the biggest window. Uses a different message format (your adapter already converts `assistant` → `model`). Images and files consume tokens too, at a different rate than text. |

---

## 8. What to do first

| Order | Task | Effort |
| --- | --- | --- |
| 1 | Add `contextWindow` and `maxOutputTokens` to `config/models.js` | 15 min |
| 2 | Add `estimateTokens()` and the fit check in `modelRouter.js` | 1 hour |
| 3 | Filter candidates by size before ranking by difficulty | 1 hour |
| 4 | Pass `maxOutputTokens` consistently through all four adapters | 1 hour |
| 5 | Detect "too long" errors and retry on a bigger model | 1 hour |
| 6 | Sliding-window trimming (strategy A) | 2 hours |
| 7 | Summarize-with-cheap-model (strategy C) | half a day |

Steps 1 to 3 remove a real failure mode that exists in the code today.
Step 7 is the one worth showing off.
