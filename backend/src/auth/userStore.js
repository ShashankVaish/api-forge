/**
 * userStore.js
 *
 * Stores developer accounts created via Google/GitHub OAuth login.
 * Simple JSON file store (data/users.json) — same pattern as keyStore.js,
 * fine for a demo/prototype. Swap for a real DB later without touching
 * anything else, since this is the only place that reads/writes user data.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "users.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

/**
 * Finds an existing user by (provider, providerId), or creates a new one.
 * Called from the Passport strategy callback on every successful login.
 */
function findOrCreateUser({ provider, providerId, email, name, avatarUrl }) {
  const store = readStore();
  let user = store.users.find(u => u.provider === provider && u.providerId === providerId);

  if (user) {
    // Keep profile fields fresh on repeat logins.
    user.email = email || user.email;
    user.name = name || user.name;
    user.avatarUrl = avatarUrl || user.avatarUrl;
    writeStore(store);
    return user;
  }

  user = {
    id: crypto.randomUUID(),
    provider,        // "google" | "github"
    providerId,       // the id from that provider's profile
    email: email || null,
    name: name || "Unnamed developer",
    avatarUrl: avatarUrl || null,
    createdAt: new Date().toISOString(),
  };
  store.users.push(user);
  writeStore(store);
  return user;
}

function getUserById(id) {
  const store = readStore();
  return store.users.find(u => u.id === id) || null;
}

module.exports = { findOrCreateUser, getUserById };
