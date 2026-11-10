const mongoose = require('mongoose');

const xWatchSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    username: { type: String, required: true }, // lowercase, no @
    displayName: { type: String, default: '' },
    // Newest tweet already alerted. Set to the current newest on add so
    // old posts aren't blasted into the group.
    lastTweetId: { type: String, default: null },
    addedBy: { type: String, required: true },
  },
  { timestamps: true }
);

xWatchSchema.index({ groupId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('XWatch', xWatchSchema);
