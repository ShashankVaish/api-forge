/**
 * contextFixtures.js
 *
 * Test cases for contextManager.planContext() (see docs/task-context-window.md).
 *
 * Token counts here come from tokenEstimator (chars / 4 for prose), so a
 * message built with tokensOf(300) is exactly 300 estimated tokens. Fake
 * models keep the numbers small enough to check by hand:
 *
 *   tiny  window 1,000   max out   500   provider groq
 *   small window 4,000   max out 2,000   provider mistral
 *   big   window 100,000 max out 8,000   provider gemini
 *   wide  window 100,000 max out 20,000  provider groq   (above gateway ceiling)
 *
 * With safetyMargin 0.15: paddedInput = ceil(tokens * 1.15).
 */

const tokensOf = (n) => "a".repeat(n * 4);

const MODELS = {
  tiny: {
    key: "tiny", provider: "groq", model: "fake-tiny", label: "Tiny",
    contextWindow: 1000, maxOutputTokens: 500, approxCostPer1kTokens: 0.0001,
  },
  small: {
    key: "small", provider: "mistral", model: "fake-small", label: "Small",
    contextWindow: 4000, maxOutputTokens: 2000, approxCostPer1kTokens: 0.0005,
  },
  big: {
    key: "big", provider: "gemini", model: "fake-big", label: "Big",
    contextWindow: 100000, maxOutputTokens: 8000, approxCostPer1kTokens: 0.001,
  },
  wide: {
    key: "wide", provider: "groq", model: "fake-wide", label: "Wide",
    contextWindow: 100000, maxOutputTokens: 20000, approxCostPer1kTokens: 0.001,
  },
  // Big window, but the provider caps each request far lower (Groq free tier).
  capped: {
    key: "capped", provider: "groq", model: "fake-capped", label: "Capped",
    contextWindow: 131072, maxOutputTokens: 65536, maxRequestTokens: 8000,
    approxCostPer1kTokens: 0.0004,
  },
};

const user = (n) => ({ role: "user", content: tokensOf(n) });
const assistant = (n) => ({ role: "assistant", content: tokensOf(n) });
const system = (n) => ({ role: "system", content: tokensOf(n) });

const ALL_KEYS = ["groq", "mistral", "gemini"];

module.exports = {
  MODELS,
  fixtures: [
    {
      id: 1,
      note: "fits on the first candidate — no upgrade, no trim",
      input: {
        messages: [user(200)],
        candidates: [MODELS.tiny, MODELS.big],
        expectedOutputTokens: 300,
        keys: ALL_KEYS,
      },
      // padded 230 + reserved 300 = 530 <= 1000. maxOut = min(500, 1000-230, 8192)
      expect: { modelKey: "tiny", upgraded: false, trimmed: false, maxTokensOut: 500 },
    },
    {
      id: 2,
      note: "ladder upgrade when the cheap model cannot fit (D2)",
      input: {
        messages: [user(700)],
        candidates: [MODELS.tiny, MODELS.big],
        expectedOutputTokens: 300,
        keys: ALL_KEYS,
      },
      // tiny: 805 + 300 > 1000. big fits.
      expect: { modelKey: "big", upgraded: true, trimmed: false },
    },
    {
      id: 3,
      note: "explicit model trims instead of switching (D3)",
      input: {
        messages: [system(50), user(300), assistant(300), user(100)],
        candidates: [MODELS.tiny],
        allowModelSwitch: false,
        expectedOutputTokens: 300,
        keys: ALL_KEYS,
      },
      expect: {
        modelKey: "tiny", upgraded: false, trimmed: true,
        keepsSystem: true, keepsLastUser: true, keepsFirstUser: true,
        droppedAtLeast: 1, fitsAfter: true,
      },
    },
    {
      id: 4,
      note: "trim keeps system + last user + first user, drops the middle (D6)",
      input: {
        messages: [
          system(50),
          user(150), assistant(150),
          user(150), assistant(150),
          user(150), assistant(150),
          user(100),
        ],
        candidates: [MODELS.tiny],
        allowModelSwitch: false,
        expectedOutputTokens: 300,
        keys: ALL_KEYS,
      },
      expect: {
        modelKey: "tiny", trimmed: true,
        keepsSystem: true, keepsLastUser: true, keepsFirstUser: true,
        droppedAtLeast: 2, fitsAfter: true,
      },
    },
    {
      id: 5,
      note: "single message bigger than every window -> 413 (D6 step 6)",
      input: {
        messages: [user(2000)],
        candidates: [MODELS.tiny],
        allowModelSwitch: false,
        expectedOutputTokens: 100,
        keys: ALL_KEYS,
      },
      expect: { throws: "ContextTooLargeError", status: 413 },
    },
    {
      id: 6,
      note: "max_tokens from the request body is respected as a ceiling (D9)",
      input: {
        messages: [user(200)],
        candidates: [MODELS.tiny],
        expectedOutputTokens: 300,
        requestedMaxTokens: 100,
        keys: ALL_KEYS,
      },
      expect: { modelKey: "tiny", maxTokensOut: 100 },
    },
    {
      id: 7,
      note: "output floor: no room for an answer means it does NOT fit (D5)",
      input: {
        // padded 748; 1000 - 748 = 252 < floor 256 -> tiny rejected.
        messages: [user(650)],
        candidates: [MODELS.tiny, MODELS.big],
        expectedOutputTokens: 100,
        keys: ALL_KEYS,
      },
      expect: { modelKey: "big", upgraded: true },
    },
    {
      id: 8,
      note: "a candidate with no provider key is skipped, even if it would fit",
      input: {
        // 712 tokens total does not fit tiny; big would, but has no key,
        // so we must trim for tiny instead.
        messages: [user(300), assistant(300), user(100)],
        candidates: [MODELS.tiny, MODELS.big],
        expectedOutputTokens: 300,
        keys: ["groq"], // no gemini key -> big is not eligible
      },
      expect: { modelKey: "tiny", upgraded: false, trimmed: true, droppedAtLeast: 1, fitsAfter: true },
    },
    {
      id: 9,
      note: "gateway ceiling caps max_tokens below the model's own cap",
      input: {
        messages: [user(200)],
        candidates: [MODELS.wide],
        expectedOutputTokens: 300,
        keys: ALL_KEYS,
      },
      // min(20000, 100000-230, 8192) = 8192
      expect: { modelKey: "wide", maxTokensOut: 8192 },
    },
    {
      id: 10,
      note: "utilization is reported as padded input / window",
      input: {
        messages: [user(500)],
        candidates: [MODELS.tiny],
        expectedOutputTokens: 100,
        keys: ALL_KEYS,
      },
      // padded 575 / 1000
      expect: { modelKey: "tiny", utilizationApprox: 0.58 },
    },
    {
      id: 11,
      note: "no candidate at all has a key -> clear error, not a crash",
      input: {
        messages: [user(10)],
        candidates: [MODELS.big],
        expectedOutputTokens: 100,
        keys: [],
      },
      expect: { throws: "NoEligibleModelError" },
    },
    {
      id: 12,
      note: "provider per-request cap overrides the model window (Groq free tier)",
      input: {
        // 20k tokens fits a 131k window but not an 8k cap -> upgrade to big.
        messages: [user(20000)],
        candidates: [MODELS.capped, MODELS.big],
        expectedOutputTokens: 300,
        keys: ALL_KEYS,
      },
      expect: { modelKey: "big", upgraded: true },
    },
    {
      id: 13,
      note: "max_tokens sent is sized to the cap, so input + output stays under it",
      input: {
        messages: [user(5000)],
        candidates: [MODELS.capped],
        expectedOutputTokens: 300,
        keys: ALL_KEYS,
      },
      // padded 5755; 8000 - 5755 = 2245 -> max_tokens must not exceed that.
      expect: { modelKey: "capped", maxTokensOut: 2245, contextWindowReported: 8000 },
    },
  ],

  // Messages that each provider actually returns when the prompt is too long.
  contextErrorMessages: [
    "Groq API error (400): {\"error\":{\"message\":\"Please reduce the length of the messages or completion.\",\"type\":\"invalid_request_error\",\"code\":\"context_length_exceeded\"}}",
    "Mistral API error (400): Prompt contains 150000 tokens, which exceeds the maximum context length of 131072",
    "Anthropic API error (400): {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"prompt is too long: 210000 tokens > 200000 maximum\"}}",
    "Gemini API error (400): {\"error\":{\"code\":400,\"message\":\"The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).\",\"status\":\"INVALID_ARGUMENT\"}}",
    // Groq free tier: the request itself is over the per-request TPM cap.
    "Groq API error (413): {\"error\":{\"message\":\"Request too large for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 69257, please reduce your message size and try again.\",\"type\":\"tokens\",\"code\":\"request_too_large\"}}",
  ],
  notContextErrorMessages: [
    "Groq API error (401): Invalid API Key",
    "Mistral API error (429): Rate limit exceeded",
    // Same TPM wording but a TIMING problem, not a size problem: do not retry bigger.
    "Groq API error (429): {\"error\":{\"message\":\"Rate limit reached for model `openai/gpt-oss-20b` on tokens per minute (TPM): Limit 8000, Used 7500, Requested 1000. Please try again in 2.5s.\",\"type\":\"tokens\",\"code\":\"rate_limit_exceeded\"}}",
    "fetch failed",
  ],
};
