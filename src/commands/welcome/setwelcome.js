const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'setwelcome',
  category: 'welcome',
  description: '/setwelcome Hello @user welcome to {group} - customize the welcome message',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args, msg }) {
    const text = args.join(' ');
    if (!text) return msg.reply('Usage: /setwelcome Hello @user, welcome to {group}!\nUse @user and {group} as placeholders.');

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { welcomeMessage: text }, { upsert: true });
    await chat.sendMessage(`✅ Welcome message updated:\n${text}`);
  },
};
