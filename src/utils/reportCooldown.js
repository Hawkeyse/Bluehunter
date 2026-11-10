// Per-group cooldown for report-style commands (e.g. /activity, /topchatters).
// Unlike cooldown.js (per-user, applies to every command as anti-spam), this
// is scoped to a single command name + group: it's meant so ANYONE using the
// command locks it for everyone in that group for a while, not just the caller.
// Not persisted on purpose - resets on restart, same as cooldown.js.

const lastUsed = new Map(); // `${commandName}:${groupId}` -> timestamp

/** Returns remaining ms on cooldown, or 0 if free to run. */
function getRemaining(commandName, groupId, cooldownMs) {
  const key = `${commandName}:${groupId}`;
  const last = lastUsed.get(key);
  if (!last) return 0;
  const elapsed = Date.now() - last;
  return elapsed >= cooldownMs ? 0 : cooldownMs - elapsed;
}

function trigger(commandName, groupId) {
  lastUsed.set(`${commandName}:${groupId}`, Date.now());
}

/** Report cooldowns are at most a few minutes; anything older than an hour is dead weight. */
function prune() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, t] of lastUsed) if (t < cutoff) lastUsed.delete(k);
}

module.exports = { getRemaining, trigger, prune };