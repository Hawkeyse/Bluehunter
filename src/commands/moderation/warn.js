const { createWarning, countWarnings } = require('../../utils/warnStore');
const audit = require('../../utils/auditLog');
const { getTargetUser } = require('../../utils/mentions');
const { protectedTargetKind } = require('../../utils/permissions');
const { AUTO_KICK_THRESHOLD } = require('../../utils/moderationAction');

module.exports = {
  name: 'warn',
  category: 'moderation',
  description: '/warn @user [reason] - give a warning',
  adminOnly: true,
  groupOnly: true,
  async execute({ client, msg, chat, args, senderId }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to warn.');

    const protectedKind = await protectedTargetKind(client, target);
    if (protectedKind) {
      return msg.reply(protectedKind === 'bot' ? "I can't do that to myself 🙂" : "That's the bot owner - I won't act against them.");
    }

    const reason = args.filter((a) => !a.startsWith('@')).join(' ') || 'No reason given';
    await createWarning({ groupId: chat.id._serialized, userId: target, reason, moderatorId: senderId });

    const count = await countWarnings(chat.id._serialized, target);
    await chat.sendMessage(
      `⚠️ @${target.split('@')[0]} has been warned (${count}/${AUTO_KICK_THRESHOLD}). Reason: ${reason}`,
      { mentions: [target] }
    );

    if (count >= AUTO_KICK_THRESHOLD) {
      try {
        await audit.runAs({ actorId: senderId, source: 'command', command: 'warn', reason: `Reached ${AUTO_KICK_THRESHOLD} warnings (auto-kick)` }, () => chat.removeParticipants([target]));
        await chat.sendMessage(`🚫 @${target.split('@')[0]} reached ${AUTO_KICK_THRESHOLD} warnings and was auto-kicked.`, {
          mentions: [target],
        });
      } catch (err) {
        await chat.sendMessage(
          `⚠️ @${target.split('@')[0]} reached ${AUTO_KICK_THRESHOLD} warnings but I couldn't remove them - I need to be an admin in this group to do that.`,
          { mentions: [target] }
        );
      }
    }
  },
};
