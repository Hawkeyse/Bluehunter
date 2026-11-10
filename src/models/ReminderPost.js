const mongoose = require('mongoose');

// A scheduled group post (text, or image/video with a caption) - see
// utils/reminderPosts.js (shared logic), utils/reminderPostScheduler.js,
// commands/groupcontrol/remindpost.js and the dashboard "Reminder posts" tab.
// Not the same thing as the per-user Reminder model (/remind).
const reminderPostSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    text: { type: String, default: '', maxlength: 1500 }, // message text, or the caption when there is media
    mediaFile: { type: String, default: '' }, // file name inside reminder-media/
    mediaType: { type: String, enum: ['', 'image', 'video'], default: '' },
    mediaMime: { type: String, default: '' },
    time: { type: String, required: true }, // "HH:mm" UTC
    days: { type: [Number], default: [] }, // UTC weekdays, 0 = Sunday. Empty = every day
    tagAll: { type: Boolean, default: false }, // silently mention every member
    enabled: { type: Boolean, default: true },
    lastPostedDate: { type: String, default: '' }, // "YYYY-MM-DD" UTC dedupe, one post per day
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReminderPost', reminderPostSchema);
