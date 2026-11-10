const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'aimoderation',
  category: 'moderation',
  description: '/aimoderation on|off - AI reads every message/image/video/sticker/voice-note/document against your group description and moderates (delete + 2-strike auto-kick)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /aimoderation on|off');

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { aiModerationEnabled: state === 'on' },
      { upsert: true }
    );

    await chat.sendMessage(
      `🤖 AI moderation is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.` +
      (state === 'on'
        ? `\nIf your group description has rules, I'll enforce those. Either way, I always enforce a strict safety baseline: no hate speech, sexual content, violence, scams, harassment, or spam - even with no description set.\nViolations get deleted and struck; 2 strikes = auto-kick (separate from the regular /warn 3-strike system).\nUse /aicases @user any time to review what was flagged and why.`
        : '')
    );
  },
};