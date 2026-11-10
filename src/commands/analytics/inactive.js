const Activity = require('../../models/Activity');

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

module.exports = {
  name: 'inactive',
  category: 'analytics',
  description: '/inactive - members with no tracked messages in the last 14 days',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat }) {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const firstRecord = await Activity.findOne({ groupId: chat.id._serialized }).sort({ createdAt: 1 }).select('createdAt');
    const trackedDays = firstRecord && firstRecord.createdAt ? (Date.now() - firstRecord.createdAt.getTime()) / (24 * 60 * 60 * 1000) : 0;
    const trackingNote = trackedDays < 14 ? `\n\n(Note: I've only been tracking this group for ${trackedDays.toFixed(1)} day(s), so this list will include people who simply haven't spoken yet.)` : '';
    const activeIds = new Set(
      (await Activity.find({ groupId: chat.id._serialized, lastMessageAt: { $gte: since } }, 'userId')).map((a) =>
        normalize(a.userId)
      )
    );

    // normalize() on both sides fixes the same @lid/phone-number mismatch
    // that was hitting /removeinactive - this command shares the identical bug,
    // just without the removal step to make it visible.
    const inactive = chat.participants.filter((p) => !activeIds.has(normalize(p.id._serialized)));
    if (inactive.length === 0) return chat.sendMessage('Everyone has been active in the last 14 days. 🎉');

    // Mention using the real phone number when the bot knows it (same
    // participant-list resolution as /slap etc. - see funTarget.js) instead
    // of a raw @lid id, which doesn't render as a proper, tappable mention.
    const mentions = inactive.map((p) => p.jid || p.id._serialized);
    const list = inactive.map((p, i) => `${i + 1}. @${p.jid ? normalize(p.jid) : p.id.user}`).join('\n');
    await chat.sendMessage(`😴 Inactive members (14+ days, ${inactive.length}):\n${list}${trackingNote}`, { mentions });
  },
};