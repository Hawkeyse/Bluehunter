// In-memory per-user-per-chat cooldown, shared across all commands.
// Not persisted on purpose - this is meant to stop rapid command spam, not survive restarts.

const COOLDOWN_MS = 6_000;
const lastUsed = new Map(); // "userId:chatId" -> timestamp

function key(userId, chatId) {
  return `${userId}:${chatId || 'dm'}`;
}

/** Returns remaining ms on cooldown, or 0 if the user is free to run a command in this chat. */
function getRemaining(userId, chatId) {
  const last = lastUsed.get(key(userId, chatId));
  if (!last) return 0;
  const elapsed = Date.now() - last;
  return elapsed >= COOLDOWN_MS ? 0 : COOLDOWN_MS - elapsed;
}

function trigger(userId, chatId) {
  lastUsed.set(key(userId, chatId), Date.now());
}

/** Drops entries whose cooldown has long expired (the map used to grow forever). */
function prune() {
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [k, t] of lastUsed) if (t < cutoff) lastUsed.delete(k);
}

module.exports = { getRemaining, trigger, prune, COOLDOWN_MS };
