const GroupSettings = require('../../models/GroupSettings');

const VALID = ['delete', 'warn', 'strike', 'kick'];

module.exports = {
  name: 'antilinkaction',
  category: 'groupcontrol',
  description: '/antilinkaction delete|warn|strike|kick - what happens when antilink catches someone',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const action = (args[0] || '').toLowerCase();
    if (!VALID.includes(action)) {
      return chat.sendMessage(
        `Usage: /antilinkaction delete|warn|strike|kick\n\n` +
        `• delete - remove the message + notify\n` +
        `• warn - same as delete (kept separate for clarity)\n` +
        `• strike - delete + warning + counts toward 3-strike auto-kick\n` +
        `• kick - delete + warning + kick immediately`
      );
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antilinkAction: action }, { upsert: true });
    await chat.sendMessage(`🔗 Antilink action set to: *${action}*`);
  },
};
