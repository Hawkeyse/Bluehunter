const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'safetyflags',
  category: 'system',
  description: '/safetyflags - list groups BlueHunter auto-left for a safety violation',
  ownerOnly: true,
  async execute({ msg }) {
    const flagged = await GroupSettings.find({ autoLeftForSafety: true }).sort({ autoLeftAt: -1 });
    if (flagged.length === 0) return msg.reply('No groups currently flagged.');

    const list = flagged
      .map(
        (g, i) =>
          `${i + 1}. ${g.autoLeftGroupName || '(unknown name)'} - ${g.groupId}\n   Left: ${
            g.autoLeftAt ? g.autoLeftAt.toLocaleString() : 'unknown'
          }`
      )
      .join('\n');

    await msg.reply(`⚠️ Flagged groups (${flagged.length}):\n${list}\n\nUse /allowgroup <groupId> to clear one.`);
  },
};