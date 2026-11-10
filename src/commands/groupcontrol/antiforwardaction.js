const GroupSettings = require('../../models/GroupSettings');

const VALID = ['delete', 'warn', 'strike', 'kick'];

module.exports = {
  name: 'antiforwardaction',
  category: 'groupcontrol',
  description: '/antiforwardaction delete|warn|strike|kick - what happens when antiforward catches someone',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const action = (args[0] || '').toLowerCase();
    if (!VALID.includes(action)) {
      return chat.sendMessage(
        `Usage: /antiforwardaction delete|warn|strike|kick\n\n` +
        `• delete - remove the message + notify\n` +
        `• warn - same as delete (kept separate for clarity)\n` +
        `• strike - delete + warning + counts toward 3-strike auto-kick\n` +
        `• kick - delete + warning + kick immediately`
      );
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antiforwardAction: action }, { upsert: true });
    await chat.sendMessage(`↪️ Antiforward action set to: *${action}*`);
  },
};
