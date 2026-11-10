// Detects coordinated spam/raids: many messages from many DIFFERENT senders in
// a short window (e.g. several accounts each posting one sticker at once).
// This is deliberately separate from floodTracker.js, which only catches ONE
// user posting repeatedly - a raid spread across multiple senders never trips
// a per-user threshold, so it needs its own aggregate, group-wide check.

const groupWindows = new Map(); // groupId -> [{ ts, senderId }]
const lastTriggered = new Map(); // groupId -> timestamp, prevents re-locking repeatedly

const RAID_WINDOW_MS = 5_000; // look at messages in the last 5s
const RAID_MESSAGE_THRESHOLD = 10; // 10+ messages in that window...
const RAID_MIN_DISTINCT_SENDERS = 3; // ...from at least 3 different people = raid
const RETRIGGER_COOLDOWN_MS = 2 * 60 * 1000; // don't re-trigger for 2 minutes after acting

function record(groupId, senderId) {
  const now = Date.now();
  const arr = (groupWindows.get(groupId) || []).filter((e) => now - e.ts < RAID_WINDOW_MS);
  arr.push({ ts: now, senderId });
  groupWindows.set(groupId, arr);
}

/** Returns true at most once per RETRIGGER_COOLDOWN_MS window if raid conditions are met. */
function checkAndConsumeRaid(groupId) {
  const arr = groupWindows.get(groupId) || [];
  if (arr.length < RAID_MESSAGE_THRESHOLD) return false;

  const distinctSenders = new Set(arr.map((e) => e.senderId));
  if (distinctSenders.size < RAID_MIN_DISTINCT_SENDERS) return false;

  const last = lastTriggered.get(groupId) || 0;
  if (Date.now() - last < RETRIGGER_COOLDOWN_MS) return false;

  lastTriggered.set(groupId, Date.now());
  return true;
}

function prune() {
  const now = Date.now();
  for (const [k, arr] of groupWindows) {
    if (!arr.length || now - arr[arr.length - 1].ts > RAID_WINDOW_MS) groupWindows.delete(k);
  }
  for (const [k, t] of lastTriggered) if (now - t > RETRIGGER_COOLDOWN_MS) lastTriggered.delete(k);
}

module.exports = { record, checkAndConsumeRaid, prune };
