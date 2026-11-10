const { getTargetUser } = require('../../utils/mentions');
const { protectedTargetKind } = require('../../utils/permissions');

module.exports = {
  name: 'kick',
  category: 'moderation',
  description: '/kick @user - remove user from group',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to kick.');

    const protectedKind = await protectedTargetKind(client, target);
    if (protectedKind) {
      return msg.reply(protectedKind === 'bot' ? "I can't do that to myself 🙂" : "That's the bot owner - I won't act against them.");
    }

    try {
      await chat.removeParticipants([target]);
      await chat.sendMessage(`👢 @${target.split('@')[0]} has been kicked from the group.`, { mentions: [target] });
    } catch (err) {
      await msg.reply('❌ Failed to remove that user. Make sure I have admin rights and they are still in the group.');
    }
  },
};
