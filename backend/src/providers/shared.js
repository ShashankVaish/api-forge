/**
 * shared.js
 *
 * Small helpers every adapter uses, so each provider file stays a thin
 * translation layer and the router can rely on one error shape and one
 * finishReason vocabulary regardless of which upstream answered.
 */

/**
 * Builds the Error thrown for a non-OK upstream response. `status` is
 * attached so server.js can pass real HTTP codes through instead of a
 * blanket 502, and the body is kept in the message because that is where
 * providers put their "context length exceeded" text.
 */
async function providerError(providerName, response) {
  const errText = await response.text().catch(() => "");
  const err = new Error(`${providerName} API error (${response.status}): ${errText}`);
  err.status = response.status;
  err.provider = providerName.toLowerCase();
  return err;
}

/** OpenAI-compatible finish_reason -> "stop" | "length" | "other". */
function normalizeOpenAIFinish(reason) {
  if (!reason) return "other";
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  return "other";
}

module.exports = { providerError, normalizeOpenAIFinish };
