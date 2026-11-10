const mongoose = require('mongoose');

const youtubeWatchSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    channelTitle: { type: String, default: '' },
    // Repost video files only when an admin explicitly confirms this channel
    // is owned by them or they have permission to redistribute its uploads.
    includeVideo: { type: Boolean, default: false },
    // The most recent video the group has already been alerted about. null
    // on a freshly-added channel on purpose: the FIRST check after adding a
    // channel just records whatever's currently newest as the baseline,
    // rather than blasting out an alert for a video that's actually been up
    // for weeks - see youtubeAlertScheduler.js.
    lastVideoId: { type: String, default: null },
    addedBy: { type: String, required: true },
  },
  { timestamps: true }
);

// One watch per (group, channel) pair - adding the same channel twice
// updates the existing row instead of creating a duplicate poller.
youtubeWatchSchema.index({ groupId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('YoutubeWatch', youtubeWatchSchema);
