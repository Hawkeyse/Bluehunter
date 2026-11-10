const Activity = require('../../models/Activity');

module.exports = {
  name: 'reset',
  category: 'analytics',
  description: '/reset - clear activity tracking for THIS group only (admins only, requires "confirm")',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const groupId = chat.id._serialized;
    const isConfirmed = args.some((a) => a.toLowerCase() === 'confirm');

    const count = await Activity.countDocuments({ groupId });
    if (count === 0) return chat.sendMessage('No activity records for this group yet — nothing to reset.');

    if (!isConfirmed) {
      return chat.sendMessage(
        `⚠️ This will permanently clear activity tracking for THIS group only (${count} record(s): message counts, last-active times) — other groups are never touched.\n\n` +
        `Run /reset confirm to actually do it.`
      );
    }

    await Activity.deleteMany({ groupId });
    await chat.sendMessage(`✅ Activity tracking reset for this group (${count} record(s) cleared).`);
  },
};
