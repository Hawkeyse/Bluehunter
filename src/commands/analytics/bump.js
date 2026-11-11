const GroupSettings = require('../../models/GroupSettings');

const BUMP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

module.exports = {
  name: 'bump',
  category: 'analytics',
  description: '/bump - move this group to the top of the BlueHunter group directory (once every 24 hours)',
  groupOnly: true,
  async execute({ chat }) {
    const groupId = chat.id._serialized;
    await GroupSettings.getOrCreate(groupId);

    const now = new Date();
    const cutoff = new Date(now.getTime() - BUMP_COOLDOWN_MS);
    const bumped = await GroupSettings.findOneAndUpdate(
      {
        groupId,
        $or: [
          { lastBumpedAt: null },
          { lastBumpedAt: { $exists: false } },
          { lastBumpedAt: { $lte: cutoff } },
        ],
      },
      { $set: { lastBumpedAt: now } },
      { new: true }
    );

    if (bumped) {
      return chat.sendMessage(`🚀 *${chat.name || 'This group'}* has been bumped in the BlueHunter group directory! Anyone in this group can bump it again in 24 hours.`);
    }

    const current = await GroupSettings.findOne({ groupId }).select('lastBumpedAt').lean();
    const lastBumpedAt = current?.lastBumpedAt ? new Date(current.lastBumpedAt).getTime() : 0;
    const remaining = Math.max(0, BUMP_COOLDOWN_MS - (Date.now() - lastBumpedAt));
    const totalMinutes = Math.ceil(remaining / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return chat.sendMessage(`⏳ This group was bumped recently. Try again in ${hours}h ${minutes}m.`);
  },
};
