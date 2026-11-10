const Activity = require('../../models/Activity');
const GroupMember = require('../../models/GroupMember');

const MAX_PER_RUN = 20; // safety cap - bulk-kicking many people in one burst raises ban risk
const REMOVE_DELAY_MS = 2500; // pace removals instead of firing them all at once

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

module.exports = {
  name: 'removeinactive',
  category: 'analytics',
  description:
    '/removeinactive <days> [maxMessages] - remove members inactive for X+ days, optionally only those with Y or fewer total messages (admins + recent joiners excluded, shows a preview first)',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ chat, args, msg }) {
    const days = parseInt(args[0], 10);
    if (!days || days < 1) {
      return msg.reply(
        'Usage: /removeinactive <days> [maxMessages]\n' +
          'Example: /removeinactive 20\n' +
          'Example: /removeinactive 20 0 - only remove people who ALSO have 0 total tracked messages (extra safety net)\n\n' +
          'This shows a preview first - add "confirm" at the end to actually remove them.'
      );
    }

    const isConfirmed = args.some((a) => a.toLowerCase() === 'confirm');
    const maxMessagesArg = args.slice(1).find((a) => a.toLowerCase() !== 'confirm' && /^\d+$/.test(a));
    const maxMessages = maxMessagesArg !== undefined ? parseInt(maxMessagesArg, 10) : null;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // "No activity record" means "silent", but only if we were actually
    // watching for that long. Tracking starts when the bot joins (or after a
    // /reset), so without this check a group tracked for 2 days would treat
    // everyone who simply hasn't talked YET as inactive for ${days}+ days.
    const firstRecord = await Activity.findOne({ groupId: chat.id._serialized }).sort({ createdAt: 1 }).select('createdAt');
    if (!firstRecord) {
      return msg.reply('⚠️ No activity has been tracked in this group yet, so I can\'t tell who is inactive.');
    }
    if (firstRecord.createdAt) {
      const trackedDays = (Date.now() - firstRecord.createdAt.getTime()) / (24 * 60 * 60 * 1000);
      if (trackedDays < days) {
        return msg.reply(
          `⚠️ I've only been tracking activity in this group for ${trackedDays.toFixed(1)} day(s), so I can't tell who has been inactive for ${days}+ days - ` +
            `anyone who just hasn't spoken since I started watching would look inactive.\n` +
            (trackedDays >= 1 ? `You can use /removeinactive ${Math.floor(trackedDays)} for now, or wait until tracking is ${days} days old.` : 'Try again once I have been tracking for a while.')
        );
      }
    }

    // Pull ALL activity records for this group (not just recent ones) so we
    // can check "have they ever messaged at all" for the optional maxMessages
    // filter, AND normalize ids before comparing - chat.participants (from
    // group metadata) and Activity.userId (from message senderId) can differ
    // in @lid vs phone-number format, which was silently causing genuinely
    // active members (with real recent messages) to be misjudged as inactive.
    const allActivity = await Activity.find({ groupId: chat.id._serialized });
    const activityByNormalizedId = new Map(allActivity.map((a) => [normalize(a.userId), a]));

    let candidates = chat.participants.filter((p) => {
      if (p.isAdmin || p.isSuperAdmin) return false;

      const activity = activityByNormalizedId.get(normalize(p.id._serialized));
      const isActiveRecently = !!activity && activity.lastMessageAt >= since;
      if (isActiveRecently) return false;

      if (maxMessages !== null) {
        const totalMessages = activity ? activity.messageCount : 0;
        if (totalMessages > maxMessages) return false; // too much history to count as "inactive" under this stricter filter
      }

      return true;
    });

    // Exclude anyone who hasn't even BEEN in the group as long as the inactivity
    // window - e.g. someone who joined 3 hours ago hasn't had a fair chance to
    // message yet, and shouldn't be judged the same as someone silent for weeks.
    // Members with no tracked join date (joined before this feature existed)
    // are left in as before - we simply don't have data to exclude them by.
    // Join records can be saved under a phone jid or an @lid, so match on the
    // normalized id and try every id the participant list gives for each person.
    const memberRecords = await GroupMember.find({ groupId: chat.id._serialized });
    const joinedAtById = new Map(memberRecords.map((m) => [normalize(m.userId), m.joinedAt]));
    const joinedAtOf = (p) => [p.id._serialized, p.jid, p.lid].filter(Boolean).map((x) => joinedAtById.get(normalize(x))).find(Boolean);

    const beforeRecentJoinFilter = candidates.length;
    candidates = candidates.filter((p) => {
      const joinedAt = joinedAtOf(p);
      if (!joinedAt) return true; // no tracked join date - don't exclude, preserves old behavior
      return joinedAt <= since;
    });
    const skippedRecentJoiners = beforeRecentJoinFilter - candidates.length;

    const filterLabel = maxMessages !== null ? `, ${maxMessages} or fewer total messages` : '';

    if (candidates.length === 0) {
      return msg.reply(
        `✅ No inactive members found (${days}+ days${filterLabel}, admins excluded).` +
          (skippedRecentJoiners > 0 ? `\n(${skippedRecentJoiners} recent joiner(s) were skipped.)` : '')
      );
    }

    if (!isConfirmed) {
      // Mention using the real phone number when known (same as /inactive -
      // see funTarget.js for the same participant-list resolution), not a
      // raw @lid id, which doesn't render as a proper, tappable mention.
      const preview = candidates
        .slice(0, MAX_PER_RUN)
        .map((p, i) => `${i + 1}. @${p.jid ? normalize(p.jid) : p.id.user}`)
        .join('\n');
      const mentions = candidates.slice(0, MAX_PER_RUN).map((p) => p.jid || p.id._serialized);
      return chat.sendMessage(
        `⚠️ Found ${candidates.length} member(s) inactive for ${days}+ days${filterLabel} (admins excluded):\n${preview}\n\n` +
          (skippedRecentJoiners > 0 ? `${skippedRecentJoiners} recent joiner(s) were skipped as too new to judge.\n` : '') +
          (candidates.length > MAX_PER_RUN ? `Only the first ${MAX_PER_RUN} will be removed per run (safety cap).\n` : '') +
          `Run /removeinactive ${days}${maxMessages !== null ? ` ${maxMessages}` : ''} confirm to actually remove them.\n\n` +
          `Note: they'll be removed a few seconds apart, not all at once.`,
        { mentions }
      );
    }

    const toRemove = candidates.slice(0, MAX_PER_RUN);
    await msg.reply(`🧹 Removing ${toRemove.length} inactive member(s), a few seconds apart...`);

    let removed = 0;
    for (const p of toRemove) {
      try {
        await chat.removeParticipants([p.id._serialized]);
        removed++;
      } catch (err) {
        // may have already left, or bot lost admin mid-run - skip and continue
      }
      await new Promise((resolve) => setTimeout(resolve, REMOVE_DELAY_MS));
    }

    await chat.sendMessage(`✅ Removed ${removed} inactive member(s) (${days}+ days${filterLabel}).`);
  },
};