const { getTargetUser, numberToJid } = require('../../utils/mentions');
const { findBan, removeBan } = require('../../utils/banStore');

module.exports = {
  name: 'unban',
  category: 'moderation',
  description: '/unban @user (or /unban 233xxxxxxxxx) - remove ban',
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat, args }) {
    let target = await getTargetUser(msg);
    if (!target && args[0]) target = numberToJid(args[0]);
    if (!target) return msg.reply('Tag the user, reply to them, or give their number: /unban 233501234567');

    // findBan matches on normalized id - the ban may have been recorded
    // under a different jid form (phone jid vs @lid) than this /unban is
    // targeting, and a raw-string match used to miss those, wrongly
    // claiming the user wasn't banned at all.
    const existing = await findBan(chat.id._serialized, target);
    if (!existing) return msg.reply('That user is not banned.');
    await removeBan(existing);

    await chat.sendMessage(`✅ @${target.split('@')[0]} has been unbanned and can rejoin.`, { mentions: [target] });
  },
};
