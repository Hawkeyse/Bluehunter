const mongoose = require('mongoose');

const bugSchema = new mongoose.Schema(
  {
    bugId: { type: Number, required: true, unique: true }, // friendly sequential id, e.g. #12
    description: { type: String, required: true },
    reportedBy: { type: String, required: true },
    groupId: { type: String, default: null }, // null = reported via DM
    status: { type: String, enum: ['open', 'fixed', 'wontfix'], default: 'open' },
  },
  { timestamps: true }
);

bugSchema.statics.getNextId = async function () {
  const last = await this.findOne().sort({ bugId: -1 });
  return last ? last.bugId + 1 : 1;
};

module.exports = mongoose.model('Bug', bugSchema);