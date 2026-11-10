const BotConfig = require('../../models/BotConfig');

module.exports = {
  name: 'setsupportgroup',
  category: 'system',
  description: '/setsupportgroup - lock THIS group so only the owner can run commands here (run inside the support group)',
  ownerOnly: true,
  groupOnly: true,
  async execute({ msg, chat }) {
    const botConfig = await BotConfig.getOrCreate();
    botConfig.supportGroupId = chat.id._serialized;
    await botConfig.save();
    await msg.reply('🔒 This group is now locked as the support group. Only the owner can run commands here.');
  },
};
