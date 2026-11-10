const mongoose = require('mongoose');

// One row per moderation action (mute, unmute, kick, ban, unban, warning
// reset) or settings change. Warnings and AI-moderation cases are NOT copied
// here: the Warning collection already stores them (with evidence), and the
// dashboard reads them from there.
const auditLogSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true },
    category: { type: String, enum: ['action', 'settings'], required: true },
    type: { type: String, required: true }, // mute | unmute | kick | ban | unban | resetwarn | setting | admin_cmd
    targetId: { type: String, default: '' },
    actorId: { type: String, default: '' }, // admin jid, or 'system' / 'ai-moderation'
    source: { type: String, enum: ['command', 'dashboard', 'auto'], default: 'auto' },
    command: { type: String, default: '' },
    reason: { type: String, default: '' },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ groupId: 1, category: 1, createdAt: -1 });
// Keep 90 days of history, then Mongo removes old rows by itself.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
