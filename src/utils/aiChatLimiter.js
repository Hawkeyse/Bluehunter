const DEFAULT_GROUP_COOLDOWN_MS = 60_000;
const MIN_GROUP_COOLDOWN_MS = 60_000;
// Someone answering a question the bot itself asked is mid-conversation, so
// their reply may come back far sooner than a fresh mention would allow.
const FOLLOW_UP_MIN_GROUP_COOLDOWN_MS = 5_000;
const FOLLOW_UP_SENDER_COOLDOWN_MS = 15_000;
// One reply per person per minute keeps it human without machine-gunning the
// chat; the group cooldown and the rolling window still cap total volume.
const SENDER_COOLDOWN_MS = 60_000;
const GROUP_WINDOW_MS = 60 * 60_000;
const MAX_GROUP_ATTEMPTS_PER_WINDOW = 20;

const groupLastAttempt = new Map();
const senderLastAttempt = new Map();
const groupAttempts = new Map();

function reserveAiChatAttempt(groupId, senderId, now = Date.now(), cooldownMs = DEFAULT_GROUP_COOLDOWN_MS, followUp = false) {
  const minGroupCooldown = followUp ? FOLLOW_UP_MIN_GROUP_COOLDOWN_MS : MIN_GROUP_COOLDOWN_MS;
  const senderCooldown = followUp ? FOLLOW_UP_SENDER_COOLDOWN_MS : SENDER_COOLDOWN_MS;
  const groupCooldown = Number.isFinite(cooldownMs)
    ? Math.max(minGroupCooldown, cooldownMs)
    : DEFAULT_GROUP_COOLDOWN_MS;
  const senderKey = `${groupId}|${senderId}`;
  const groupLast = groupLastAttempt.get(groupId) || 0;
  const senderLast = senderLastAttempt.get(senderKey) || 0;
  if (now - groupLast < groupCooldown || now - senderLast < senderCooldown) return false;

  const recentAttempts = (groupAttempts.get(groupId) || []).filter((at) => now - at < GROUP_WINDOW_MS);
  if (recentAttempts.length >= MAX_GROUP_ATTEMPTS_PER_WINDOW) {
    groupAttempts.set(groupId, recentAttempts);
    return false;
  }

  recentAttempts.push(now);
  groupAttempts.set(groupId, recentAttempts);
  groupLastAttempt.set(groupId, now);
  senderLastAttempt.set(senderKey, now);
  if (senderLastAttempt.size > 1_000) {
    for (const [key, at] of senderLastAttempt) {
      if (now - at >= SENDER_COOLDOWN_MS) senderLastAttempt.delete(key);
    }
  }
  return true;
}

module.exports = { reserveAiChatAttempt };
