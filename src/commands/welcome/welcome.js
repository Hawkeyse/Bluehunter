const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'welcome',
  category: 'welcome',
  description: '/welcome on|off - toggle welcome messages',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /welcome on|off');

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { welcomeEnabled: state === 'on' },
      { upsert: true }
    );
    await chat.sendMessage(`👋 Welcome messages are now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
