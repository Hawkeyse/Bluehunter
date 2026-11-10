// Lightweight in-memory tracker for /antispam and /antiflood.
// Not persisted to Mongo on purpose - this is short-lived, per-process rate data.

const windows = new Map(); // key: `${groupId}:${userId}` -> number[] timestamps
const lastNotifiedAt = new Map(); // key: `${groupId}:${userId}` -> timestamp of last moderation notice sent

const SPAM_WINDOW_MS = 7_000; // repeated identical/near messages window
const SPAM_MAX_MESSAGES = 4; // > 4 messages in window = spam

const FLOOD_WINDOW_MS = 3_000; // rapid-fire window
const FLOOD_MAX_MESSAGES = 5; // > 5 messages in 3s = flood

// isFlooding/isSpamming stay true for every message in a burst, not just the
// first one - without this, applyModerationAction would fire (delete +
// "you're flooding" notice) on EVERY single flooded message, meaning the bot
// spams the group back at roughly the same rate as the person it's punishing.
// The message still gets deleted every time (see message.js) - this only
// throttles the notification/strike-recording side of it.
const NOTIFY_COOLDOWN_MS = 10_000;

function record(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  const arr = (windows.get(key) || []).filter((t) => now - t < Math.max(SPAM_WINDOW_MS, FLOOD_WINDOW_MS));
  arr.push(now);
  windows.set(key, arr);
  return arr;
}

function isSpamming(groupId, userId) {
  const arr = windows.get(`${groupId}:${userId}`) || [];
  const now = Date.now();
  return arr.filter((t) => now - t < SPAM_WINDOW_MS).length > SPAM_MAX_MESSAGES;
}

function isFlooding(groupId, userId) {
  const arr = windows.get(`${groupId}:${userId}`) || [];
  const now = Date.now();
  return arr.filter((t) => now - t < FLOOD_WINDOW_MS).length > FLOOD_MAX_MESSAGES;
}

/** True (and marks "notified now") at most once per NOTIFY_COOLDOWN_MS for a
 * given group+user - lets callers keep deleting every offending message
 * while only actually messaging the group / recording a strike once per burst. */
function shouldNotify(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  const last = lastNotifiedAt.get(key) || 0;
  if (now - last < NOTIFY_COOLDOWN_MS) return false;
  lastNotifiedAt.set(key, now);
  return true;
}

/** Drops per-user windows/notices that have gone quiet (these maps used to grow forever). */
function prune() {
  const now = Date.now();
  const windowMs = Math.max(SPAM_WINDOW_MS, FLOOD_WINDOW_MS);
  for (const [k, arr] of windows) {
    if (!arr.length || now - arr[arr.length - 1] > windowMs) windows.delete(k);
  }
  for (const [k, t] of lastNotifiedAt) if (now - t > NOTIFY_COOLDOWN_MS) lastNotifiedAt.delete(k);
}

module.exports = { record, isSpamming, isFlooding, shouldNotify, prune };
