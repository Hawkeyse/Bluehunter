const Bug = require('../../models/Bug');

module.exports = {
  name: 'bug',
  category: 'general',
  description: '/bug <description> - report a bug (check /bugview first to avoid duplicates)',
  async execute({ msg, chat, args, senderId }) {
    const description = args.join(' ');
    if (!description) {
      return msg.reply('Usage: /bug <describe the issue>\nTip: run /bugview first to check it isn\'t already reported.');
    }

    const bug = await Bug.create({
      reporterId: senderId,
      groupId: chat.isGroup ? chat.id._serialized : null,
      description,
    });

    await msg.reply(`🐞 Bug reported (#${bug._id.toString().slice(-5)}). Thanks for the report!`);
  },
};