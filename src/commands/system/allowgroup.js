const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'allowgroup',
  category: 'system',
  description: "/allowgroup <groupId> - clear a group's auto-left-for-safety flag (see /safetyflags for ids)",
  ownerOnly: true,
  async execute({ msg, args }) {
    const groupId = args[0];
    if (!groupId) return msg.reply('Usage: /allowgroup <groupId>\nSee /safetyflags for the list of flagged group ids.');

    const result = await GroupSettings.findOneAndUpdate(
      { groupId, autoLeftForSafety: true },
      { autoLeftForSafety: false, autoLeftAt: null, autoLeftGroupName: '' }
    );
    if (!result) return msg.reply('No flagged group found with that id.');

    await msg.reply(`✅ Safety flag cleared for "${result.autoLeftGroupName || groupId}". BlueHunter can be re-added there normally now.`);
  },
};