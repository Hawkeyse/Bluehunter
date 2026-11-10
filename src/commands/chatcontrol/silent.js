const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'silent',
  category: 'chatcontrol',
  description: '/silent on|off - bot stops replying to normal chat temporarily (commands still work)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /silent on|off');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { silent: state === 'on' }, { upsert: true });
    await chat.sendMessage(`🤫 Silent mode is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
