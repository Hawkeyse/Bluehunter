const mongoose = require('mongoose');

const warningSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    reason: { type: String, default: 'No reason given' },
    moderatorId: { type: String, required: true }, // 'system', 'ai-moderation', or an admin's jid
    source: { type: String, enum: ['manual', 'ai'], default: 'manual' }, // /warn command vs AI moderation

    // Evidence - only populated for AI-moderation strikes. Lets admins pull up
    // exactly what got flagged via /aicases instead of just trusting a reason string.
    evidenceType: { type: String, enum: ['text', 'image', 'video', 'sticker', 'voice', 'document', null], default: null },
    evidenceText: { type: String, default: '' }, // the flagged text itself, if evidenceType === 'text'
    evidencePath: { type: String, default: '' }, // local file path to saved media, if evidenceType is image/video/sticker
  },
  { timestamps: true }
);

module.exports = mongoose.model('Warning', warningSchema);