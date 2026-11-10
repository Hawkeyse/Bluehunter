const Activity = require('../../models/Activity');
const Warning = require('../../models/Warning');

module.exports = {
  name: 'stats',
  category: 'analytics',
  description: '/stats - group statistics',
  groupOnly: true,
  async execute({ chat }) {
    const [totalMessages, trackedUsers, totalWarnings] = await Promise.all([
      Activity.aggregate([{ $match: { groupId: chat.id._serialized } }, { $group: { _id: null, sum: { $sum: '$messageCount' } } }]),
      Activity.countDocuments({ groupId: chat.id._serialized }),
      Warning.countDocuments({ groupId: chat.id._serialized }),
    ]);

    const messageSum = totalMessages[0]?.sum || 0;

    const text = [
      `📊 *Stats for ${chat.name}*`,
      `🆔 Group ID: ${chat.id._serialized}`,
      `👥 Members: ${chat.participants.length}`,
      `💬 Total tracked messages: ${messageSum}`,
      `🙋 Active senders tracked: ${trackedUsers}`,
      `⚠️ Total warnings issued: ${totalWarnings}`,
    ].join('\n');

    await chat.sendMessage(text);
  },
};
