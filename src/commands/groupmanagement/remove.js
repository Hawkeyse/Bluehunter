const { getTargetUser } = require('../../utils/mentions');

module.exports = {
  name: 'remove',
  category: 'groupmanagement',
  description: '/remove @user - remove member',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ msg, chat }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to remove.');

    try {
      await chat.removeParticipants([target]);
      await chat.sendMessage(`✅ @${target.split('@')[0]} has been removed from the group.`, { mentions: [target] });
    } catch (err) {
      await msg.reply('❌ Failed to remove that user.');
    }
  },
};
