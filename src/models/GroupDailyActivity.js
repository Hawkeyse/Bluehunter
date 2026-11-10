const mongoose = require('mongoose');

// One document per group per UTC day - a lightweight, group-level counter
// separate from the per-user Activity model, used for the "last N days"
// message-volume graph on the web dashboard.
const groupDailyActivitySchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD', UTC
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

groupDailyActivitySchema.index({ groupId: 1, date: 1 }, { unique: true });

/**
 * Increments today's counter for a group. Called on every group message
 * (see events/message.js) - callers should .catch() this, same as
 * Activity.track, since it's best-effort and should never crash message
 * handling.
 */
groupDailyActivitySchema.statics.bump = function bump(groupId, when = new Date()) {
  const date = when.toISOString().slice(0, 10);
  return this.findOneAndUpdate({ groupId, date }, { $inc: { count: 1 } }, { upsert: true, setDefaultsOnInsert: true });
};

module.exports = mongoose.model('GroupDailyActivity', groupDailyActivitySchema);
