const { getTargetUser } = require('../../utils/mentions');
const { protectedTargetKind } = require('../../utils/permissions');
const { parseDuration } = require('../../utils/duration');
const { upsertMute } = require('../../utils/muteStore');

module.exports = {
  name: 'mute',
  category: 'moderation',
  description: '/mute @user 10m|1h|1d|perm - mute a user in group chat',
  adminOnly: true,
  groupOnly: true,
  // NOTE: WhatsApp has no native per-user mute. This is enforced bot-side:
  // the bot deletes messages from muted users until the mute expires or /unmute is used.
  async execute({ client, msg, chat, args, senderId }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user you want to mute. Example: /mute @user 1h');

    const protectedKind = await protectedTargetKind(client, target);
    if (protectedKind) {
      return msg.reply(protectedKind === 'bot' ? "I can't do that to myself 🙂" : "That's the bot owner - I won't act against them.");
    }

    const durationArg = args.find((a) => /^(\d+[smhd]|perm|permanent)$/i.test(a));
    const { ms, valid } = parseDuration(durationArg || '1h');
    if (!valid) return msg.reply('Invalid duration. Use formats like 10m, 1h, 1d, or perm.');

    const reason = args.filter((a) => a !== durationArg && !a.startsWith('@')).join(' ') || 'No reason given';
    const mutedUntil = ms ? new Date(Date.now() + ms) : null;

    // upsertMute matches on normalized id, not the raw jid string - otherwise
    // muting the same person again (via a different mention/reply form)
    // would create a second, untracked mute instead of updating it.
    await upsertMute(chat.id._serialized, target, mutedUntil, reason, senderId);

    const durationLabel = mutedUntil ? `until ${mutedUntil.toLocaleString()}` : 'permanently';
    await chat.sendMessage(`🔇 @${target.split('@')[0]} has been muted ${durationLabel}.`, { mentions: [target] });
  },
};
