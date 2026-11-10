const Bug = require('../../models/Bug');

module.exports = {
  name: 'resolvebug',
  category: 'system',
  description: '/resolvebug <id> - mark a bug report as resolved (use the #id shown in /bugview)',
  ownerOnly: true,
  async execute({ msg, args }) {
    const idFragment = (args[0] || '').toLowerCase();
    if (!idFragment) return msg.reply('Usage: /resolvebug <id> (the #id shown in /bugview)');

    const bugs = await Bug.find({ resolved: false });
    const bug = bugs.find((b) => b._id.toString().endsWith(idFragment));
    if (!bug) return msg.reply('No open bug found with that id.');

    bug.resolved = true;
    await bug.save();
    await msg.reply(`✅ Marked bug #${idFragment} as resolved: "${bug.description}"`);
  },
};