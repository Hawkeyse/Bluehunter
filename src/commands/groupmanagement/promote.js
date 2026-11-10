const { getTargetUser } = require('../../utils/mentions');

module.exports = {
  name: 'promote',
  category: 'groupmanagement',
  description: '/promote @user - make admin',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ msg, chat }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to promote.');

    try {
      await chat.promoteParticipants([target]);
      await chat.sendMessage(`⬆️ @${target.split('@')[0]} is now an admin.`, { mentions: [target] });
    } catch (err) {
      await msg.reply('❌ Failed to promote that user.');
    }
  },
};
