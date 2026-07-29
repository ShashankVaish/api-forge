/**
 * server.js
 *
 * API Forge — an OpenRouter-style gateway with developer authentication.
 *
 * Two separate auth mechanisms, for two different callers:
 *   1. Browser session (Google/GitHub OAuth via Passport) — used by a
 *      developer logging into a dashboard to manage their own Forge keys.
 *   2. Forge API key (Authorization: Bearer <forge_key>) — used by the
 *      developer's own app/backend to actually call the AI gateway. This
 *      is the credential that behaves like an OpenRouter key.
 *
 * Endpoints:
 *   GET    /auth/google              -> start Google OAuth login
 *   GET    /auth/google/callback     -> Google redirects back here
 *   GET    /auth/github              -> start GitHub OAuth login
 *   GET    /auth/github/callback     -> GitHub redirects back here
 *   GET    /auth/me                  -> current logged-in user (session)
 *   POST   /auth/logout              -> end the session
 *   POST   /v1/keys                  -> generate a new Forge key (needs session)
 *   GET    /v1/keys                  -> list YOUR keys (needs session)
 *   DELETE /v1/keys/:id              -> revoke YOUR key (needs session)
 *   POST   /v1/chat/completions      -> main gateway (needs a Forge key)
 *   GET    /v1/stats                 -> aggregate usage + estimated savings
 *   GET    /health                   -> liveness check
 */

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("./src/auth/passportConfig");
const { requireAuth } = require("./src/auth/authMiddleware");
const { routeRequest } = require("./src/modelRouter");
const usageTracker = require("./src/usageTracker");
const keyStore = require("./src/keystore/keyStore");

const app = express();
app.use(express.json({ limit: "2mb" }));

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// CORS: must echo a SPECIFIC origin (not "*") and allow credentials, since
// the OAuth session relies on a cookie being sent cross-origin from the
// frontend to this backend.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_URL);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Session (backs Passport's login state). MemoryStore is fine for a
// demo/prototype; swap for a persistent store (e.g. connect-redis) if you
// deploy this for real, since MemoryStore resets on every server restart.
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: "lax",
  },
}));
app.use(passport.initialize());
app.use(passport.session());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "api-forge" });
});

// ── OAuth login routes ──────────────────────────────────────────────────

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: `${FRONTEND_URL}/login?error=google` }),
  (_req, res) => res.redirect(`${FRONTEND_URL}/dashboard`)
);

app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));

app.get("/auth/github/callback",
  passport.authenticate("github", { failureRedirect: `${FRONTEND_URL}/login?error=github` }),
  (_req, res) => res.redirect(`${FRONTEND_URL}/dashboard`)
);

/** Frontend calls this (with credentials: 'include') to check login state. */
app.get("/auth/me", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json({ user: req.user });
  }
  res.status(401).json({ error: "Not authenticated" });
});

app.post("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ loggedOut: true });
    });
  });
});

// ── Key management (requires a logged-in session) ─────────────────────

/**
 * Generate a new Forge key, owned by the logged-in developer.
 * Body: { "name": "my app" }
 * Returns the FULL raw key ONCE — store it, it won't be shown again.
 */
app.post("/v1/keys", requireAuth, (req, res) => {
  const { name } = req.body || {};
  const record = keyStore.generateKey(name, req.user.id);
  res.json({
    message: "Store this key now — it will not be shown in full again.",
    id: record.id,
    name: record.name,
    key: record.key,
    createdAt: record.createdAt,
  });
});

/** List the logged-in developer's own keys (masked) with usage so far. */
app.get("/v1/keys", requireAuth, (req, res) => {
  res.json({ keys: keyStore.listKeys(req.user.id) });
});

/** Revoke one of the logged-in developer's own keys. */
app.delete("/v1/keys/:id", requireAuth, (req, res) => {
  const ok = keyStore.revokeKey(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: "Key not found" });
  res.json({ revoked: true });
});

// ── Main AI gateway (requires a Forge API key, NOT a session) ─────────

/**
 * Body shape mirrors OpenAI's chat completions:
 * {
 *   "model": "auto" | "haiku" | "sonnet" | "opus" | "groq-fast" | "groq-strong"
 *           | "gemini-flash" | "gemini-pro" | "mistral-small" | "mistral-large",
 *   "messages": [{ "role": "user", "content": "..." }]
 * }
 *
 * Auth: `Authorization: Bearer <forge_key>` — the developer's OWN Forge
 * key (from POST /v1/keys above), same pattern as OpenRouter/OpenAI.
 */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const authHeader = req.header("Authorization") || "";
    const forgeKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!forgeKey) {
      return res.status(401).json({
        error: "Missing Authorization: Bearer <forge_key> header. Generate one via POST /v1/keys (requires login).",
      });
    }

    const keyRecord = keyStore.validateKey(forgeKey);
    if (!keyRecord) {
      return res.status(401).json({ error: "Invalid or revoked API Forge key" });
    }

    const { model = "auto", messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "`messages` array is required" });
    }

    const result = await routeRequest({ messages, requestedModel: model });

    usageTracker.record({ tier: result.routing.tier, usage: result.usage });
    keyStore.recordUsage(forgeKey, {
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
    });

    res.json({
      id: `forge_${Date.now()}`,
      model: result.routing.model,
      routing: result.routing,
      choices: [
        { message: { role: "assistant", content: result.text } },
      ],
      usage: result.usage,
    });
  } catch (err) {
    console.error("Error in /v1/chat/completions:", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get("/v1/stats", (_req, res) => {
  res.json(usageTracker.getStats());
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API Forge running on http://localhost:${PORT}`);
  console.log(`Frontend expected at: ${FRONTEND_URL}`);
  console.log("");
  console.log("Login: open in a browser -> " + `http://localhost:${PORT}/auth/google` + " or /auth/github");
});
