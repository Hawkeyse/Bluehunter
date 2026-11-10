const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antiforward',
  category: 'groupcontrol',
  description: '/antiforward on|off - block forwarded messages/media from non-admins',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /antiforward on|off');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antiforward: state === 'on' }, { upsert: true });
    await chat.sendMessage(`↪️ Antiforward is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
