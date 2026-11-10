module.exports = {
  name: 'setdesc',
  category: 'groupmanagement',
  description: '/setdesc <new description> - change the group description',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat, args }) {
    const description = args.join(' ');
    if (!description) return msg.reply('Usage: /setdesc <new group description>');

    try {
      await client.groupUpdateDescription(chat.id._serialized, description);
      await msg.reply('✅ Group description updated.');
    } catch (err) {
      await msg.reply(`❌ Failed to update group description: ${err.message}`);
    }
  },
};