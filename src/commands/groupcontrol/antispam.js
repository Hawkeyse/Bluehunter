const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antispam',
  category: 'groupcontrol',
  description: '/antispam on|off - stop message flooding of repeated/similar messages',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /antispam on|off');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antispam: state === 'on' }, { upsert: true });
    await chat.sendMessage(`🛡️ Antispam is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
