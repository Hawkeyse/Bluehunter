const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antigroupstatus',
  category: 'groupcontrol',
  description: '/antigroupstatus on|off - delete WhatsApp group-status shares and warn members',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /antigroupstatus on|off');

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { antigroupstatus: state === 'on' },
      { upsert: true }
    );
    await chat.sendMessage(
      `📵 Antigroupstatus is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.` +
      (state === 'on' ? '\nStatus shares are deleted immediately; members receive a strike and are auto-kicked at 3.' : '')
    );
  },
};