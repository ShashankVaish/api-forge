/**
 * authMiddleware.js
 *
 * Guards routes that require a logged-in developer (session-based, via
 * Passport). Used on the key-management endpoints (/v1/keys) — NOT on
 * /v1/chat/completions, which is authenticated differently, via the
 * developer's own Forge API key (that's the credential their deployed
 * app/backend uses; it doesn't have a browser session).
 */

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({
    error: "Not authenticated. Log in via GET /auth/google or GET /auth/github first.",
  });
}

module.exports = { requireAuth };
