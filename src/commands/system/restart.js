module.exports = {
  name: 'restart',
  category: 'system',
  description: '/restart - restart the bot process (requires a process manager like pm2 to bring it back up)',
  ownerOnly: true,
  async execute({ msg }) {
    await msg.reply('♻️ Restarting... (make sure Bluehunter is running under pm2 or similar so it comes back up)');
    setTimeout(() => process.exit(0), 1000);
  },
};
