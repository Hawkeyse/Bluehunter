// Patience tracker for AI moderation of interpersonal conflict.
//
// Moderation judges one message at a time, so a single heated line should
// never trigger anything - people vent, argue and fall out with each other
// (and with admins) all the time. Instead we count how often the SAME person
// is flagged for a serious personal attack inside a window, and only step in
// once it is clearly not a one-off:
//   - below MEDIATE_AT flags: do nothing at all (silent)
//   - at MEDIATE_AT flags:    one short, neutral calm-down note (rate-limited)
//   - at STRIKE_AT flags:     it has gone far - delete + strike, then reset

const FLAG_WINDOW_MS = 30 * 60 * 1000; // flags older than this stop counting
const MEDIATE_AT = 3;
const STRIKE_AT = 6;
const MEDIATION_COOLDOWN_MS = 60 * 60 * 1000; // at most one calm-down note per group per hour
const ANNOUNCE_COOLDOWN_MS = 10 * 60 * 1000; // at most one strike notice per group per 10 min

const flags = new Map(); // `${groupId}|${userId}` -> number[] (timestamps)
const lastMediatedAt = new Map(); // groupId -> timestamp
const lastAnnouncedAt = new Map(); // groupId -> timestamp

function recordConflictFlag(groupId, userId) {
  const key = `${groupId}|${userId}`;
  const now = Date.now();
  const recent = (flags.get(key) || []).filter((t) => now - t < FLAG_WINDOW_MS);
  recent.push(now);
  flags.set(key, recent);
  return recent.length;
}

function resetConflictFlags(groupId, userId) {
  flags.delete(`${groupId}|${userId}`);
}

function canMediate(groupId) {
  const last = lastMediatedAt.get(groupId);
  return !last || Date.now() - last >= MEDIATION_COOLDOWN_MS;
}

function markMediated(groupId) {
  lastMediatedAt.set(groupId, Date.now());
}

function canAnnounce(groupId) {
  const last = lastAnnouncedAt.get(groupId);
  return !last || Date.now() - last >= ANNOUNCE_COOLDOWN_MS;
}

function markAnnounced(groupId) {
  lastAnnouncedAt.set(groupId, Date.now());
}

function prune() {
  const now = Date.now();
  for (const [k, list] of flags) {
    const recent = list.filter((t) => now - t < FLAG_WINDOW_MS);
    if (recent.length) flags.set(k, recent);
    else flags.delete(k);
  }
  for (const [k, t] of lastMediatedAt) if (now - t > MEDIATION_COOLDOWN_MS) lastMediatedAt.delete(k);
  for (const [k, t] of lastAnnouncedAt) if (now - t > ANNOUNCE_COOLDOWN_MS) lastAnnouncedAt.delete(k);
}

module.exports = {
  MEDIATE_AT,
  STRIKE_AT,
  recordConflictFlag,
  resetConflictFlags,
  canMediate,
  markMediated,
  canAnnounce,
  markAnnounced,
  prune,
};
