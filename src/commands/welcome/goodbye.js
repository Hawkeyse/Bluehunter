const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'goodbye',
  category: 'welcome',
  description: '/goodbye on|off - toggle leave messages',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /goodbye on|off');

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { goodbyeEnabled: state === 'on' },
      { upsert: true }
    );
    await chat.sendMessage(`👋 Goodbye messages are now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
