const mongoose = require('mongoose');

const afkSchema = new mongoose.Schema({
  groupId: { type: String, required: true, index: true }, // chat.id._serialized - a DM has its own id here too, so DMs and each group are all scoped separately
  userId: { type: String, required: true, index: true },
  reason: { type: String, default: '' },
  since: { type: Date, default: Date.now },
});

afkSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Afk', afkSchema);