// Per-minute message counts for the dashboard's live graph.
//
// GroupDailyActivity only stores one number per day, which is too coarse to
// animate. This keeps the last few hours in memory, one bucket per minute.
// It hooks GroupDailyActivity.bump (already called on every group message by
// events/message.js), so no other file has to change.
//
// Memory only: after a restart the live graph starts empty and fills up again.
const GroupDailyActivity = require('../models/GroupDailyActivity');

const BUCKET_MS = 60_000;
const KEEP_BUCKETS = 180; // 3 hours
const groups = new Map(); // groupId -> Map(minuteStartMs -> count)

function record(groupId, when = Date.now()) {
  const minute = Math.floor(when / BUCKET_MS) * BUCKET_MS;
  let buckets = groups.get(groupId);
  if (!buckets) groups.set(groupId, (buckets = new Map()));
  buckets.set(minute, (buckets.get(minute) || 0) + 1);
  if (buckets.size > KEEP_BUCKETS + 20) {
    const cutoff = minute - KEEP_BUCKETS * BUCKET_MS;
    for (const k of buckets.keys()) if (k < cutoff) buckets.delete(k);
  }
}

// Oldest first, one entry per minute (zeros included) so the graph has no gaps.
// 61 points represent the 60 intervals in a one-hour view.
function series(groupId, minutes = 60) {
  const buckets = groups.get(groupId);
  const nowMinute = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const out = [];
  for (let i = minutes - 1; i >= 0; i--) {
    const t = nowMinute - i * BUCKET_MS;
    out.push({ t, count: (buckets && buckets.get(t)) || 0 });
  }
  return out;
}

function install() {
  if (GroupDailyActivity.__liveHooked) return;
  const original = GroupDailyActivity.bump;
  GroupDailyActivity.bump = function bump(groupId, when = new Date()) {
    try { record(groupId, when instanceof Date ? when.getTime() : Date.now()); } catch (e) { /* never block message handling */ }
    return original.call(this, groupId, when);
  };
  GroupDailyActivity.__liveHooked = true;
}

module.exports = { install, record, series };
