# API Forge

A single-API-key gateway that dynamically routes prompts to different AI
models based on **prompt complexity**, reducing token/cost usage — inspired
by how OpenRouter lets one key call multiple models.

## The core idea

Instead of a developer hardcoding "always call GPT-4 / Opus" for every
request (expensive, wasteful for simple queries), API Forge sits in front of
your calls and:

1. Analyzes the incoming prompt with cheap, in-process heuristics
   (length, keyword signals, code blocks, multi-part questions, context size)
2. Scores it 0–100 and buckets it into a tier: `simple` / `moderate` / `complex`
3. Routes to a cheaper/faster model for simple stuff (e.g. Haiku) and a
   stronger model only when the prompt actually needs it (e.g. Opus)
4. Tracks usage so you can see estimated $ saved vs always using the top model

The developer's client code stays almost identical to calling any single
model API — they just point at API Forge's endpoint instead, with `model: "auto"`.

## Architecture

```
Client (your frontend)
      │
      ▼
POST /v1/chat/completions
      │
      ▼
complexityAnalyzer.js  → scores the prompt (0-100), picks a tier
      │
      ▼
config/models.js       → tier -> {provider, model} mapping
      │
      ▼
modelRouter.js          → picks the right provider adapter
      │
      ▼
providers/anthropicProvider.js  (or openaiProvider.js, etc.)
      │
      ▼
Actual model API call → response + usage returned to client,
                         along with routing metadata (which tier/model/why)
```

Adding a new provider = write one adapter file with a `call(model, messages, apiKey)`
function. Adding a new tier/model = one line in `config/models.js`.

## Running it

```bash
npm install
npm start
# server runs on http://localhost:3001
```

Test the routing logic alone (no API key, no network needed):
```bash
npm run test:local
```

Call the real gateway (needs your own Anthropic API key):
```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-provider-api-key: YOUR_ANTHROPIC_KEY" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Explain quicksort vs mergesort with time complexity"}]}'
```

Check savings so far:
```bash
curl http://localhost:3001/v1/stats
```

You can also force a specific model instead of auto-routing:
`"model": "haiku" | "sonnet" | "opus" | "gemini-flash" | "gemini-pro" | "groq-fast" | "groq-strong"`.

### Using Groq (recommended second real provider)

Groq is fully wired up as a real (non-mock) provider. Get a free key at
https://console.groq.com/keys, then:

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-provider-api-key: YOUR_GROQ_KEY" \
  -d '{"model":"groq-fast","messages":[{"role":"user","content":"hi"}]}'
```

Groq uses standard `Authorization: Bearer` auth (OpenAI-compatible), so it
doesn't have the key-format ambiguity Gemini currently has (see note below).

### Note on Gemini

The Gemini adapter is implemented (`src/providers/geminiProvider.js`), but as
of mid-2026 Google has been rolling out a new "Auth key" format (`AQ.` prefix)
that has known issues on Google's side for many developers (`API_KEY_SERVICE_BLOCKED`
errors even with valid, freshly-created keys — see reports on
https://discuss.ai.google.dev). If a provider call fails for any reason, the
gateway degrades gracefully rather than crashing — see "Fallback behavior" below.

### Fallback behavior

If an upstream provider call fails (auth issue, outage, rate limit, etc.),
`modelRouter.js` catches the error and returns a clearly-labeled fallback
response instead of throwing. Check `routing.usedFallback` and
`routing.fallbackReason` in the response to see if this happened. This keeps
the rest of the pipeline (routing decisions, latency tracking, stats)
demonstrable even when a specific upstream provider is having issues.


## Connecting your existing frontend

Point your frontend's fetch/axios calls at `POST http://localhost:3001/v1/chat/completions`
with the body shape shown above, and pass the upstream API key via the
`x-provider-api-key` header. The response includes a `routing` object showing
exactly which model was picked and why — good for a UI badge like
"Answered by: Sonnet (balanced) — complexity score 39".

---

## Interview prep notes

**How to describe it in one line:**
"API Forge is a lightweight gateway — one API key in, and it dynamically
picks which underlying model to call based on how complex the prompt is,
so simple queries don't waste money on an expensive model."

**Likely questions & how to answer:**

- *"How do you measure complexity without calling another model?"*
  Heuristics: word count, presence of code blocks, count of question marks
  (multi-part asks), a keyword list correlated with reasoning-heavy tasks
  (architecture, optimize, compare, debug, etc.), and conversation length.
  It's deliberately cheap and deterministic — calling an LLM just to judge
  complexity would eat the savings you're trying to create.

- *"What happens if the heuristic gets it wrong?"*
  Two safety valves: (1) the client can always override with an explicit
  model instead of `auto`, and (2) thresholds are config values, easy to
  tune from real traffic data (a v2 version could log outcomes and re-tune
  the score cutoffs, or add a lightweight ML classifier trained on labeled
  examples instead of hand-written keyword rules).

- *"How would you extend this to multiple real providers (OpenAI, Gemini)?"*
  Point to the adapter pattern — `providers/` folder, each exposing the same
  `call(model, messages, apiKey)` shape. Mention the included `openaiProvider.js`
  mock as proof the router doesn't care which provider actually serves a tier.

- *"How do you avoid storing/leaking the user's API key?"*
  It's passed per-request via a header, never persisted or logged, and used
  only to make the outbound call. In a production version you'd want this
  encrypted at rest if ever cached, plus rate-limiting per key.

- *"What does /stats give you?"*
  Aggregated counts per tier and an estimated cost comparison: what was
  actually spent vs. a baseline of "every request had used the top-tier
  model." That's the concrete ROI number you'd show a stakeholder.

- *"Why not just let the client always choose the model themselves?"*
  They can (via the explicit model param) — but most developers don't want
  to write per-prompt logic to decide "is this simple or hard," so the
  gateway takes that decision off their plate by default.

**Be upfront if asked "is this in production / used by real users":**
Frame it as a working prototype/personal project you built to explore the
idea — that's a completely normal and honest thing to say about a resume
project, and it's much stronger than getting caught overstating it. Interviewers
generally care more about whether you can explain your design decisions and
trade-offs than whether it's had real production traffic.

---

## OpenRouter-style flow (Forge keys) — IMPORTANT UPDATE

API Forge no longer requires developers to bring their own upstream
provider key (BYOK). Instead, it works like OpenRouter:

1. **You (the platform owner)** put your own real provider keys in `.env`
   (see `.env.example`) — Groq, Mistral, Anthropic, Gemini. These never
   leave the server.
2. **Developers using your platform** generate their own Forge key:
   ```bash
   curl.exe -X POST "http://localhost:3001/v1/keys" -H "Content-Type: application/json" -d "{\"name\":\"my app\"}"
   ```
   Response includes a `key` like `forge_ab12...` — shown in full only once.
3. **They use that Forge key in their app**, exactly like an OpenRouter key:
   ```bash
   curl.exe -X POST "http://localhost:3001/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer forge_ab12..." -d "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
   ```
   API Forge validates the Forge key, decides which real model to call
   (complexity routing, same as before), and uses ITS OWN upstream key to
   fulfill the request. The developer never sees Groq/Anthropic/etc.

4. **Check usage per key:**
   ```bash
   curl.exe http://localhost:3001/v1/keys
   ```
   Shows masked keys + request/token counts per developer key.

5. **Revoke a key:**
   ```bash
   curl.exe -X DELETE "http://localhost:3001/v1/keys/THE_KEY_ID"
   ```

Forge keys are stored in `data/forgeKeys.json` (gitignored). This is a
simple file-based store, fine for a demo/prototype — swap
`src/keystore/keyStore.js` for a real DB later without touching anything
else, since it's the only place that reads/writes key data.

### Available models via `model` field

`auto` (complexity-routed) | `haiku` | `sonnet` | `opus` (Anthropic —
needs `ANTHROPIC_API_KEY`, paid) | `groq-fast` | `groq-strong` (Groq — free)
| `gemini-flash` | `gemini-pro` (Gemini — free, currently has known
provider-side issues, see note above) | `mistral-small` | `mistral-large`
(Mistral — free tier available)

---

## Authentication (Google / GitHub OAuth) — IMPORTANT UPDATE

Key management (`POST /v1/keys`, `GET /v1/keys`, `DELETE /v1/keys/:id`) now
requires the developer to be **logged in** via Google or GitHub. Each Forge
key is owned by the developer who created it — no one can see or revoke
another developer's keys.

### 1. Set up OAuth apps

**Google:** https://console.cloud.google.com/apis/credentials
→ Create OAuth client ID → Web application
→ Authorized redirect URI: `http://localhost:3001/auth/google/callback`

**GitHub:** https://github.com/settings/developers → New OAuth App
→ Authorization callback URL: `http://localhost:3001/auth/github/callback`

Put the resulting client IDs/secrets in `.env` (see `.env.example`), along
with a random `SESSION_SECRET`, and set `FRONTEND_URL` to wherever your
frontend runs (e.g. `http://localhost:5173`).

### 2. Login flow (for your frontend)

- **"Login with Google" button** → full-page redirect (not fetch) to:
  `http://localhost:3001/auth/google`
- **"Login with GitHub" button** → full-page redirect to:
  `http://localhost:3001/auth/github`
- After successful login, the backend redirects the browser to
  `${FRONTEND_URL}/dashboard`.
- On that dashboard page (and anywhere you need to know who's logged in),
  call `GET /auth/me` **with `credentials: 'include'`** in fetch/axios, so
  the session cookie is sent. Returns `{ user: {...} }` if logged in, or
  401 if not.
- **Logout:** `POST /auth/logout` with `credentials: 'include'`.

**Every call to `/v1/keys` (POST/GET/DELETE) from your frontend must also
include `credentials: 'include'`** so the session cookie is sent — without
it you'll get 401 "Not authenticated" even after logging in.

### 3. `/v1/chat/completions` is unaffected

This endpoint still authenticates purely via the Forge key
(`Authorization: Bearer <forge_key>`) — no session/cookie needed there,
since it's meant to be called from a developer's own backend/app, not a
logged-in browser.

### New files

- `src/auth/userStore.js` — stores developer accounts (`data/users.json`)
- `src/auth/passportConfig.js` — Google + GitHub Passport strategies
- `src/auth/authMiddleware.js` — `requireAuth` guard used on `/v1/keys` routes
