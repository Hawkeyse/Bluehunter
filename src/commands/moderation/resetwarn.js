const { deleteWarnings } = require('../../utils/warnStore');
const { getTargetUser } = require('../../utils/mentions');

module.exports = {
  name: 'resetwarn',
  category: 'moderation',
  description: '/resetwarn @user - clear warnings',
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user whose warnings you want to clear.');

    await deleteWarnings(chat.id._serialized, target);
    await chat.sendMessage(`✅ Warnings cleared for @${target.split('@')[0]}.`, { mentions: [target] });
  },
};
