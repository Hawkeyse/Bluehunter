const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antiflood',
  category: 'groupcontrol',
  description: '/antiflood on|off - prevent rapid-fire message spam',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /antiflood on|off');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antiflood: state === 'on' }, { upsert: true });
    await chat.sendMessage(`🌊 Antiflood is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
