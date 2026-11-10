const mongoose = require('mongoose');

const muteSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    mutedUntil: { type: Date, default: null }, // null = permanent, until /unmute
    reason: { type: String, default: 'No reason given' },
    moderatorId: { type: String, required: true },
  },
  { timestamps: true }
);

muteSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Mute', muteSchema);
