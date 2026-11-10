module.exports = {
  name: 'whoami',
  category: 'general',
  description: '/whoami - show your raw WhatsApp sender id (useful for setting OWNER_LID in .env)',
  async execute({ msg, senderId }) {
    await msg.reply(
      `🪪 Your sender id in this chat is:\n\`${senderId}\`\n\n` +
      `If it ends in @lid and you're the bot owner, copy the number part (before @lid) into OWNER_LID in your .env file, then restart the bot.`
    );
  },
};
