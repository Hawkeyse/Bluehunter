const GroupSettings = require('../../models/GroupSettings');

const VALID = ['delete', 'warn', 'strike', 'kick'];

module.exports = {
  name: 'badwordaction',
  category: 'chatcontrol',
  description: '/badwordaction delete|warn|strike|kick - what happens when the bad word filter catches someone',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const action = (args[0] || '').toLowerCase();
    if (!VALID.includes(action)) {
      return chat.sendMessage(
        `Usage: /badwordaction delete|warn|strike|kick\n\n` +
        `• delete - remove the message + notify\n` +
        `• warn - same as delete (kept separate for clarity)\n` +
        `• strike - delete + warning + counts toward 3-strike auto-kick\n` +
        `• kick - delete + warning + kick immediately`
      );
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { badwordsAction: action }, { upsert: true });
    await chat.sendMessage(`🧹 Bad word filter action set to: *${action}*`);
  },
};
