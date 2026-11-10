const mongoose = require('mongoose');
const { BOT_MODE_DEFAULT } = require('../config');

const botConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  mode: { type: String, enum: ['public', 'private'], default: BOT_MODE_DEFAULT },
  bio: { type: String, default: 'Bluehunter - your global WhatsApp moderation bot' },
  approvedGroups: { type: [String], default: [] }, // used when mode = private
  supportGroupId: { type: String, default: null }, // if set, only the owner can run commands here
});

botConfigSchema.statics.getOrCreate = async function () {
  const existing = await this.findOne({ key: 'global' });
  if (existing) return existing;
  try {
    return await this.create({ key: 'global' });
  } catch (err) {
    if (err && err.code === 11000) return this.findOne({ key: 'global' }); // lost a create race - read the winner
    throw err;
  }
};

module.exports = mongoose.model('BotConfig', botConfigSchema);