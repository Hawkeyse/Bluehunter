const { getTargetUser } = require('../../utils/mentions');
const { protectedTargetKind } = require('../../utils/permissions');
const { upsertBan } = require('../../utils/banStore');

module.exports = {
  name: 'ban',
  category: 'moderation',
  description: '/ban @user - block user from rejoining',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  // NOTE: WhatsApp has no native "ban". This kicks the user AND remembers them,
  // so if anyone re-adds them, the bot auto-kicks them again on group_join.
  async execute({ client, msg, chat, args, senderId }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to ban.');

    const protectedKind = await protectedTargetKind(client, target);
    if (protectedKind) {
      return msg.reply(protectedKind === 'bot' ? "I can't do that to myself 🙂" : "That's the bot owner - I won't act against them.");
    }

    const reason = args.filter((a) => !a.startsWith('@')).join(' ') || 'No reason given';

    // upsertBan matches on normalized id, not the raw jid string - otherwise
    // banning the same person again (via a different mention/reply form)
    // would create a second, untracked ban record instead of updating it.
    await upsertBan(chat.id._serialized, target, reason, senderId);

    try {
      await chat.removeParticipants([target]);
    } catch (err) {
      // may already be out of the group, that's fine
    }

    await chat.sendMessage(`🔨 @${target.split('@')[0]} has been banned. Reason: ${reason}`, { mentions: [target] });
  },
};
