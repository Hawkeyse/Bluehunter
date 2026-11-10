const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'aichat',
  category: 'chatcontrol',
  description: '/aichat on|off - toggle the AI chatbot personality (replies when mentioned or replied to)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /aichat on|off');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { aiChatEnabled: state === 'on' }, { upsert: true });
    await chat.sendMessage(`🤖 AI chat is now ${state === 'on' ? 'ENABLED' : 'DISABLED'} in this group.`);
  },
};
