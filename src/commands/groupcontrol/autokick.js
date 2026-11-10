const GroupSettings = require('../../models/GroupSettings');
const { isBotAdmin } = require('../../utils/permissions');
const { findInactive, normalize, DEFAULT_GRACE_HOURS } = require('../../utils/autoKick');

const MAX_MESSAGES_LIMIT = 50;
const MAX_GRACE_HOURS = 720; // 30 days

const USAGE =
  'Usage:\n' +
  '/autokick on <maxMessages> [graceHours] - e.g. /autokick on 1 24\n' +
  '/autokick off\n' +
  '/autokick preview - who would be removed right now\n' +
  '/autokick - current status\n\n' +
  'Removes members who have maxMessages or fewer messages after being in the group longer than graceHours (default ' +
  DEFAULT_GRACE_HOURS + 'h). Admins, new joiners inside the grace time, and members from before join tracking are never removed.';

module.exports = {
  name: 'autokick',
  aliases: ['autoremoveinactive'],
  category: 'groupcontrol',
  description: '/autokick on <maxMessages> [graceHours]|off|preview - automatically remove members with few or no messages (new joiners get a grace period)',
  adminOnly: true,
  groupOnly: true,
  async execute({ client, chat, args, msg }) {
    const groupId = chat.id._serialized;
    const sub = (args[0] || '').toLowerCase();
    const settings = await GroupSettings.getOrCreate(groupId);

    if (sub === 'off') {
      await GroupSettings.findOneAndUpdate({ groupId }, { autoKickEnabled: false }, { upsert: true });
      return chat.sendMessage('⏹️ Auto-kick is now DISABLED.');
    }

    if (sub === 'on') {
      const maxRaw = args[1];
      const graceRaw = args[2];
      if (maxRaw === undefined || !/^\d+$/.test(maxRaw)) return msg.reply(USAGE);
      const maxMessages = parseInt(maxRaw, 10);
      if (maxMessages > MAX_MESSAGES_LIMIT) return msg.reply(`Max messages can be 0 to ${MAX_MESSAGES_LIMIT}.`);
      let graceHours = settings.autoKickGraceHours || DEFAULT_GRACE_HOURS;
      if (graceRaw !== undefined) {
        if (!/^\d+$/.test(graceRaw) || parseInt(graceRaw, 10) < 1 || parseInt(graceRaw, 10) > MAX_GRACE_HOURS) {
          return msg.reply(`Grace time must be 1 to ${MAX_GRACE_HOURS} hours.`);
        }
        graceHours = parseInt(graceRaw, 10);
      }
      await GroupSettings.findOneAndUpdate(
        { groupId },
        { autoKickEnabled: true, autoKickMaxMessages: maxMessages, autoKickGraceHours: graceHours },
        { upsert: true }
      );
      return chat.sendMessage(
        `🧹 Auto-kick is now ENABLED.\n` +
          `Removes members with ${maxMessages === 0 ? 'no messages' : `${maxMessages} message(s) or fewer`} who joined more than ${graceHours}h ago.\n` +
          `Admins and recent joiners are safe. Removals happen in small batches, a few seconds apart.\n` +
          `Tip: /autokick preview shows who would go first.` +
          (isBotAdmin(chat, client) ? '' : '\n⚠️ I am not an admin here yet - make me admin or nobody can be removed.')
      );
    }

    if (sub === 'preview') {
      const candidates = await findInactive(client, chat, settings);
      if (!candidates.length) return chat.sendMessage('✅ Nobody would be removed right now with the current settings.');
      const shown = candidates.slice(0, 20);
      const list = shown.map((p, i) => `${i + 1}. @${p.jid ? normalize(p.jid) : p.id.user}`).join('\n');
      return chat.sendMessage(
        `⚠️ ${candidates.length} member(s) would be removed (${settings.autoKickMaxMessages || 0} message(s) or fewer, joined ${settings.autoKickGraceHours || DEFAULT_GRACE_HOURS}h+ ago):\n${list}` +
          (candidates.length > shown.length ? `\n...and ${candidates.length - shown.length} more` : ''),
        { mentions: shown.map((p) => p.jid || p.id._serialized) }
      );
    }

    return chat.sendMessage(
      `🧹 Auto-kick is ${settings.autoKickEnabled ? 'ENABLED' : 'DISABLED'}.\n` +
        `Max messages: ${settings.autoKickMaxMessages || 0} | Grace time: ${settings.autoKickGraceHours || DEFAULT_GRACE_HOURS}h\n\n` +
        USAGE
    );
  },
};
