const INTRO_MESSAGE = `The seal has been broken. Vawulence is no longer restrained. Whatever your ass are planning, reconsider before you become a footnote in my storyline.`;

// In-memory, per-process, short-lived. When /join sends the intro itself
// right after accepting an invite, it marks the group here so the
// group-participants.update handler (which also fires for self-joins) knows
// not to send a second copy. Entries expire on their own after a couple of
// minutes so nothing needs cleaning up.
const recentlyIntroduced = new Map(); // groupId -> expiry timestamp
const MARK_TTL_MS = 2 * 60 * 1000;

function markIntroduced(groupId) {
  recentlyIntroduced.set(groupId, Date.now() + MARK_TTL_MS);
}

/** Returns true (and consumes the mark) if this group was already introduced very recently. */
function consumeRecentlyIntroduced(groupId) {
  const expiry = recentlyIntroduced.get(groupId);
  if (!expiry) return false;
  recentlyIntroduced.delete(groupId);
  return expiry > Date.now();
}

module.exports = { INTRO_MESSAGE, markIntroduced, consumeRecentlyIntroduced };
