const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'setgoodbye',
  category: 'welcome',
  description: '/setgoodbye Bye @user 👋 - customize the goodbye message',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args, msg }) {
    const text = args.join(' ');
    if (!text) return msg.reply('Usage: /setgoodbye Bye @user 👋\nUse @user and {group} as placeholders.');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { goodbyeMessage: text }, { upsert: true });
    await chat.sendMessage(`✅ Goodbye message updated:\n${text}`);
  },
};
