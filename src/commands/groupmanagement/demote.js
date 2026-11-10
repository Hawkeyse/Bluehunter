const { getTargetUser } = require('../../utils/mentions');

module.exports = {
  name: 'demote',
  category: 'groupmanagement',
  description: '/demote @user - remove admin',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ msg, chat }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to demote.');

    try {
      await chat.demoteParticipants([target]);
      await chat.sendMessage(`⬇️ @${target.split('@')[0]} is no longer an admin.`, { mentions: [target] });
    } catch (err) {
      await msg.reply('❌ Failed to demote that user.');
    }
  },
};
