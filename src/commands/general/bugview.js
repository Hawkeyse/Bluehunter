const Bug = require('../../models/Bug');

module.exports = {
  name: 'bugview',
  aliases: ['viewbug'],
  category: 'general',
  description: '/bugview - list currently open bug reports (also works as /viewbug)',
  async execute({ msg }) {
    const bugs = await Bug.find({ resolved: false }).sort({ createdAt: -1 }).limit(20);
    if (bugs.length === 0) return msg.reply('✅ No open bug reports right now.');

    const list = bugs.map((b, i) => `${i + 1}. [#${b._id.toString().slice(-5)}] ${b.description}`).join('\n');
    await msg.reply(`🐞 Open bug reports (${bugs.length}):\n${list}`);
  },
};