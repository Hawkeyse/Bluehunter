const mongoose = require('mongoose');

const banSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    reason: { type: String, default: 'No reason given' },
    moderatorId: { type: String, required: true },
  },
  { timestamps: true }
);

banSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Ban', banSchema);
