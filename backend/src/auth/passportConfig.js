/**
 * passportConfig.js
 *
 * Configures Passport strategies for "Login with Google" / "Login with
 * GitHub" for developers using the API Forge platform.
 *
 * On successful login we find-or-create a local user record (userStore.js)
 * and store only the user's internal id in the session (serializeUser),
 * keeping the session payload small — the full user is looked back up on
 * each request via deserializeUser.
 *
 * If a provider's env vars aren't set, that strategy is simply skipped
 * (with a console warning) rather than crashing the server — lets you run
 * with just one provider configured (e.g. only GitHub) if you want.
 */

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const userStore = require("./userStore");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${BACKEND_URL}/auth/google/callback`,
    },
    (accessToken, refreshToken, profile, done) => {
      try {
        const user = userStore.findOrCreateUser({
          provider: "google",
          providerId: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.displayName,
          avatarUrl: profile.photos?.[0]?.value,
        });
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  ));
} else {
  console.warn("[passportConfig] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set — Google login disabled.");
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${BACKEND_URL}/auth/github/callback`,
    },
    (accessToken, refreshToken, profile, done) => {
      try {
        const user = userStore.findOrCreateUser({
          provider: "github",
          providerId: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.displayName || profile.username,
          avatarUrl: profile.photos?.[0]?.value,
        });
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  ));
} else {
  console.warn("[passportConfig] GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET not set — GitHub login disabled.");
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const user = userStore.getUserById(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
