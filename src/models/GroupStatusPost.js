const mongoose = require('mongoose');

const groupStatusPostSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true },
    messageId: { type: String, required: true },
    authorId: { type: String, default: '' },
    key: { type: mongoose.Schema.Types.Mixed, required: true },
    seenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

groupStatusPostSchema.index({ groupId: 1, messageId: 1 }, { unique: true });
groupStatusPostSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('GroupStatusPost', groupStatusPostSchema);
