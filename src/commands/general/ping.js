module.exports = {
  name: 'ping',
  category: 'general',
  description: '/ping - check if the bot is alive and responsive',
  async execute({ client, msg }) {
    const start = Date.now();
    const sent = await msg.reply('🏓 Pinging...');
    const ms = Date.now() - start;
    await client.sendMessage(msg.from, { text: `🏓 Pong! ${ms}ms`, edit: sent.key });
  },
};
