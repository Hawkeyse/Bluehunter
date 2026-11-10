const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    displayName: { type: String, default: '' }, // pushName at time of last message, best-effort
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

activitySchema.index({ groupId: 1, userId: 1 }, { unique: true });

/**
 * Upserts the per-user, per-group activity counter. Called on every message
 * (see events/message.js) - callers should .catch() this since it's a
 * best-effort tracker, not something that should ever crash message handling.
 */
activitySchema.statics.track = function track(groupId, userId, pushName) {
  const update = {
    $inc: { messageCount: 1 },
    $set: { lastMessageAt: new Date() },
  };
  if (pushName) update.$set.displayName = pushName;

  return this.findOneAndUpdate({ groupId, userId }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
};

module.exports = mongoose.model('Activity', activitySchema);