const BotConfig = require('../../models/BotConfig');

module.exports = {
  name: 'setbio',
  category: 'system',
  description: '/setbio <text> - update the bot description shown in /help and /owner',
  ownerOnly: true,
  async execute({ msg, args }) {
    const text = args.join(' ');
    if (!text) return msg.reply('Usage: /setbio <text>');

    const botConfig = await BotConfig.getOrCreate();
    botConfig.bio = text;
    await botConfig.save();

    await msg.reply(`✅ Bio updated:\n${text}`);
  },
};
