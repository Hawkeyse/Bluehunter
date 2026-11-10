module.exports = {
  name: 'setname',
  category: 'groupmanagement',
  description: '/setname <new name> - change the group name',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat, args }) {
    const name = args.join(' ');
    if (!name) return msg.reply('Usage: /setname <new group name>');
    if (name.length > 100) return msg.reply("Group names can't be longer than 100 characters.");

    try {
      await client.groupUpdateSubject(chat.id._serialized, name);
      await msg.reply(`✅ Group name updated to: ${name}`);
    } catch (err) {
      await msg.reply(`❌ Failed to update group name: ${err.message}`);
    }
  },
};