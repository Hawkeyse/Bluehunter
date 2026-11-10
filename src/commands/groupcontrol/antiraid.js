const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antiraid',
  category: 'groupcontrol',
  description: '/antiraid on|off - auto-lock the group if many different accounts spam at once (raid detection)',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /antiraid on|off');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antiraid: state === 'on' }, { upsert: true });
    await chat.sendMessage(
      `🚨 Antiraid is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.` +
      (state === 'on' ? '\nIf 10+ messages come from 3+ different accounts within 5 seconds, I\'ll lock the group and ping admins - use /open to reopen.' : '')
    );
  },
};
