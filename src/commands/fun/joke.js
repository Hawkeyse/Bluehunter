const { getJoke } = require('../../utils/jokesApi');

module.exports = {
  name: 'joke',
  category: 'fun',
  description: '/joke [dad|mom] - get a random joke right now (defaults to dad)',
  async execute({ msg, args }) {
    const type = (args[0] || '').toLowerCase() === 'mom' ? 'mom' : 'dad';
    const joke = await getJoke(type);
    if (!joke) return msg.reply("⚠️ Couldn't fetch a joke right now, try again in a bit.");
    await msg.reply(`😂 ${joke}`);
  },
};
