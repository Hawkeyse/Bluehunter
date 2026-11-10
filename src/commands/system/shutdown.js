module.exports = {
  name: 'shutdown',
  category: 'system',
  description: '/shutdown - stop the bot completely',
  ownerOnly: true,
  async execute({ msg }) {
    await msg.reply('🛑 Shutting down Bluehunter.');
    setTimeout(() => process.exit(0), 1000);
  },
};
