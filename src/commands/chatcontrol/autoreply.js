const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'autoreply',
  category: 'chatcontrol',
  description: '/autoreply on|off - auto responses system for common phrases (hi, thanks, help...)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /autoreply on|off');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { autoreply: state === 'on' }, { upsert: true });
    await chat.sendMessage(`💬 Autoreply is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
