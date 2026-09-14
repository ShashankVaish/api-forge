# Complexity Analyzer — How It Works and How to Improve It

**Code:** `backend/src/complexityAnalyzer.js`

---

## 1. What this part does

The complexity analyzer reads a prompt and guesses **how hard it is**.

Based on that guess, API Forge sends the prompt to a cheap model or an
expensive one.

This is the heart of the whole project. If the guess is good, users save
money. If the guess is bad, two things go wrong:

- **Guess too low** → a hard question goes to a weak model → bad answer.
- **Guess too high** → an easy question goes to a costly model → wasted money.

So the analyzer is worth getting right.

---

## 2. How it works today

The analyzer takes **the last user message** and gives it points.
More points = harder prompt.

| What it checks | Points added |
| --- | --- |
| Under 8 words | 0 |
| 8 to 39 words | 15 |
| 40 to 119 words | 30 |
| 120+ words | 45 |
| Message has a code block | +20 |
| More than one `?` in the message | +10 |
| Hard-topic keywords found | +8 each (max 30) |
| Chat has more than 6 messages | +10 |

Then the total decides the tier:

| Score | Tier | Model used |
| --- | --- | --- |
| 0 to 24 | `simple` | Groq GPT-OSS 20B (cheapest) |
| 25 to 54 | `moderate` | Mistral Small |
| 55 to 100 | `complex` | Groq GPT-OSS 120B (strongest) |

There is also one **shortcut**. If the message looks like a greeting or a
tiny question (`hi`, `what is X?`, `define Y`), the analyzer stops early and
gives it 5 points.

**Good things about this design:**

- It is fast. No extra AI call, so it costs nothing.
- It always gives the same answer for the same prompt.
- It returns a `reasons[]` list, so you can show the user *why* a model was
  picked. That is a genuinely nice feature — keep it.

---

## 3. Where it goes wrong

These are **real test results** from the current code:

| Prompt | Result now | Should be |
| --- | --- | --- |
| "Hi, can you design a distributed rate limiter with consistent hashing and walk me through the tradeoffs?" | `simple` (5) | complex |
| "Write a complete 2000-word technical essay on database indexing." | `simple` (15) | complex |
| "prove that this improved approach is approved by the team" | keyword hit on "prove" | no hit |
| "continue" | `simple` (0) | same tier as before |
| "Refactor this:" + a 1-line code block | `moderate` (43) | simple |

Here is what causes each one.

### Problem 1 — the word "Hi" cancels everything

The shortcut checks if the message *starts with* a greeting. It does not
check how long the message is.

So "Hi, can you design a distributed system…" starts with `Hi`, the shortcut
fires, and the analyzer **returns 5 points immediately**. It never looks at
the rest of the message.

Any hard question that starts politely goes to your cheapest model. This is
the worst bug in the file.

### Problem 2 — keywords match inside other words

The code uses `text.includes("prove")`. That is a plain text search, so it
also matches:

- `prove` inside `im-prove` and `ap-prove-d`
- `compare` inside `comparable`
- `analyse` inside `analyser`

So normal sentences get scored as "hard" for no reason.

### Problem 3 — long answers are treated as free

"Write a 2000-word essay" is only 9 words. It scores 15 → cheapest model.

But the **answer** will be enormous. And output tokens usually cost 3 to 5
times more than input tokens. So the analyzer is blind to the single biggest
cost driver.

It also has no signals in the other direction. "Explain quantum computing in
one sentence" and "explain quantum computing in full detail" score almost
the same, even though one is 20x cheaper.

### Problem 4 — follow-up messages lose their history

"continue" scores 0 → cheapest model.

But if the last three turns were a hard architecture discussion on your
strongest model, turn four suddenly drops to the weakest model. The answer
quality falls off a cliff in the middle of a conversation.

The router already receives the full `messages` array. It just throws away
everything except the last user message.

### Problem 5 — tiny code counts the same as huge code

Any code block adds +20, whether it is 3 characters or 300 lines.

Also, the check counts the triple-backtick marks and divides by 2. If
someone forgets to close the block, you get `0.5` code blocks. And code
pasted **without** backticks — which is very common — is completely
invisible.

### Problem 6 — word count is not token count

Models charge by **tokens**, not words. `countWords` splits on spaces, which
badly under-counts code, and almost completely fails for languages that do
not use spaces (Chinese, Japanese, and some Indic scripts).

---

## 4. How to fix it

### Level 1 — quick bug fixes (about 30 minutes)

**Fix 1: only allow the greeting shortcut on short messages.**

```js
const isTrivial =
  words <= 12 && LOW_COMPLEXITY_PATTERNS.some((re) => re.test(text.trim()));
```

Now "Hi" is still simple, but "Hi, can you design…" is scored properly.

**Fix 2: match whole words only.**

Build the keyword checks once when the file loads, using `\b` (word
boundary) so `prove` no longer matches `improve`:

```js
const KEYWORD_RES = HIGH_COMPLEXITY_KEYWORDS.map(
  (k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
);
```

**Fix 3: score code by its size, not just its presence.**

Give a few points per line of code instead of a flat +20. Also detect code
that has no backticks around it, by looking for tell-tale signs: lines
ending in `;` `{` `}`, or words like `function`, `=>`, `def `, `class `,
`import `, `SELECT `.

---

### Level 2 — better signals (about half a day)

**Fix 4: use two scores instead of one.** *(biggest idea in this doc)*

Right now one number decides everything. But two different things drive cost:

- **difficulty** — how much thinking is needed → picks *which model*
- **size** — how much text goes in and out → picks *which price band /
  context window*

Example: a 40,000-word document with "summarize this" is **huge but easy**.
One score cannot say that. Two scores can.

Return `{ difficulty, size, tier }` and let `config/models.js` use both.
(See `docs/context-window.md` — the `size` score is exactly what that doc
needs.)

**Fix 5: detect "long answer" requests.**

Look for: `write`, `generate`, `implement`, `essay`, `article`, `full`,
`complete`, `entire`, and number patterns like "2000 words", "list 50",
"10 examples". Add these to the **size** score.

**Fix 6: detect "short answer" requests.**

You currently have no way to score a prompt *down*. Look for: `briefly`,
`concisely`, `in one sentence`, `tl;dr`, `yes or no`, `just the code`,
`one word`. Subtract from the size score.

**Fix 7: detect the type of job.**

Some jobs are cheap no matter how long they are — translating, summarizing,
reformatting, extracting data. Other jobs are expensive even when short —
"why does this deadlock?", "prove this is correct".

A small table beats adding more generic keywords:

```js
const TASK_TYPES = [
  {
    name: "transform",
    re: /\b(translate|summari[sz]e|rewrite|reformat|convert|extract)\b/i,
    difficultyDelta: -20,
  },
  {
    name: "reason",
    re: /\b(why|prove|derive|explain how|root cause|debug)\b/i,
    difficultyDelta: +20,
  },
  {
    name: "generate",
    re: /\b(write|implement|build|design|create)\b/i,
    sizeDelta: +25,
  },
];
```

**Fix 8: remember the last tier ("sticky tier").**

Store which tier the previous turn used. For the new turn, take:

```
final = max(current_score_tier, previous_tier - 1 step)
```

So a conversation can cool down slowly, but it can never crash from
`complex` to `simple` in one turn. This fixes the "continue" problem.

**Fix 9: count tokens, not words.**

Use a real tokenizer that runs locally, like the `gpt-tokenizer` npm package.
No network call, so it stays fast. Bonus: the same number can feed your cost
estimates and the context-window checks.

**Fix 10: look at the whole conversation.**

You currently use `messages.length` as a stand-in for "how much context".
But 6 one-word messages are not the same as 6 long messages. Add up the
tokens across all of them instead.

---

### Level 3 — make it learn (a weekend project)

**Fix 11: move all the numbers into a config file.**

Every `score += 15` and the `25` / `55` cutoffs are magic numbers buried in
code. Move them to `config/complexityWeights.js` so you can tune them
without changing logic — and so you can test two settings side by side.

**Fix 12: log every decision.**

Save `{ promptHash, features, score, tier, model, latency, tokens,
usedFallback }` for each request. Right now you keep none of this, so you
have no way to know whether the analyzer is doing well. Everything below
depends on having this data.

**Fix 13: try cheap first, upgrade if the answer is bad.**

This is called **cascade routing**, and it is the strongest upgrade here.

For prompts near the boundary, send to the cheap model first. Then run a
near-free check on the reply:

- Is it very short?
- Does it contain "I'm not sure", "I cannot", "As an AI"?
- Did it get cut off mid-sentence?
- If you asked for JSON, does it parse?

If the check fails, call the stronger model. You get strong-model quality at
close to cheap-model price, and "how often did we escalate?" becomes a real
metric you can show.

**Fix 14: shadow testing to collect real answers.**

On 1 or 2 out of every 100 requests, call **both** the routed model and the
top model, and save both replies. Now you have real data on "would the cheap
model have been good enough?" — for about 1% extra cost.

**Fix 15: replace the keyword list with a small trained model.**

Once Fix 14 has collected data, train a small classifier on it. Two options
that both run **locally**, so you do not lose the speed advantage:

- Logistic regression over word frequencies (tiny, easy to explain)
- Sentence embeddings via `transformers.js` (about 10ms, no API call)

Keep the keyword version as a backup, and keep producing `reasons[]` either
way.

**Fix 16: be careful near the boundary.**

A score of 54 and a score of 55 should not produce wildly different quality.
Return a `confidence` value, and for borderline scores either round up a
tier, or send them into the cascade from Fix 13.

---

## 5. What to do first

If you only do four things:

| Order | Fix | Why |
| --- | --- | --- |
| 1 | Fix 1 — greeting shortcut | It is an outright bug. 10 minutes. |
| 2 | Fix 2 — whole-word keywords | Also an outright bug. 10 minutes. |
| 3 | Fix 8 — sticky tier | Fixes the worst quality problem users will feel. |
| 4 | Fix 5 — long-answer detection | Plugs the biggest money leak. |

After that, **Fix 13 (cascade routing)** is the one that makes this project
look genuinely well engineered.
