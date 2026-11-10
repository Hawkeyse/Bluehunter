const { getTargetUser } = require('../../utils/mentions');
const { findMute, removeMute } = require('../../utils/muteStore');

module.exports = {
  name: 'unmute',
  category: 'moderation',
  description: '/unmute @user - restore messaging access',
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to unmute.');

    // findMute matches on normalized id - the mute may have been recorded
    // under a different jid form (phone jid vs @lid) than this /unmute is
    // targeting, and a raw-string match used to miss those, wrongly
    // claiming the user wasn't muted at all.
    const existing = await findMute(chat.id._serialized, target);
    if (!existing) return msg.reply('That user is not muted.');
    await removeMute(existing);

    await chat.sendMessage(`🔊 @${target.split('@')[0]} has been unmuted.`, { mentions: [target] });
  },
};
