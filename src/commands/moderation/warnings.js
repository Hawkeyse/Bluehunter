const { findWarnings } = require('../../utils/warnStore');
const { getTargetUser } = require('../../utils/mentions');

module.exports = {
  name: 'warnings',
  category: 'moderation',
  description: '/warnings @user - check warnings',
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to check.');

    const warnings = await findWarnings(chat.id._serialized, target, { sortDir: -1 });
    if (warnings.length === 0) {
      return chat.sendMessage(`✅ @${target.split('@')[0]} has no warnings.`, { mentions: [target] });
    }

    const list = warnings.map((w, i) => `${i + 1}. ${w.reason} - ${w.createdAt.toLocaleDateString()}`).join('\n');
    await chat.sendMessage(`⚠️ Warnings for @${target.split('@')[0]} (${warnings.length}):\n${list}`, {
      mentions: [target],
    });
  },
};
