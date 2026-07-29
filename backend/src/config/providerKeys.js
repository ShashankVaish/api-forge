/**
 * providerKeys.js
 *
 * Holds API Forge's OWN upstream provider API keys (Anthropic, Groq,
 * Mistral, Gemini) — loaded from environment variables (.env).
 *
 * This is the core shift from "bring your own key" (BYOK) to an
 * OpenRouter-style platform: developers calling API Forge never see or
 * supply these upstream keys. They only ever handle their own Forge API
 * key (see src/keystore/keyStore.js). API Forge itself owns and manages
 * the real provider credentials, on the server, out of reach of callers.
 */

require("dotenv").config();

module.exports = {
  anthropic: process.env.ANTHROPIC_API_KEY || null,
  groq: process.env.GROQ_API_KEY || null,
  mistral: process.env.MISTRAL_API_KEY || null,
  gemini: process.env.GEMINI_API_KEY || null,
};
