const Activity = require('../../models/Activity');
const reportCooldown = require('../../utils/reportCooldown');

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes, shared across the whole group

module.exports = {
  name: 'topchatters',
  category: 'analytics',
  description: '/topchatters - most active members of all time (5min cooldown per group)',
  groupOnly: true,
  async execute({ chat }) {
    const groupId = chat.id._serialized;
    const remaining = reportCooldown.getRemaining('topchatters', groupId, COOLDOWN_MS);
    if (remaining > 0) {
      return chat.sendMessage(`⏳ /topchatters was just run in this group. Try again in ${Math.ceil(remaining / 60000)}m.`);
    }
    reportCooldown.trigger('topchatters', groupId);

    const top = await Activity.find({ groupId }).sort({ messageCount: -1 }).limit(10);
    if (top.length === 0) return chat.sendMessage('No message data recorded yet.');

    const medals = ['🥇', '🥈', '🥉'];
    // Fall back to the number if we never captured a pushName for this user.
    const list = top
      .map((a, i) => `${medals[i] || `${i + 1}.`} ${a.displayName || a.userId.split('@')[0]} - ${a.messageCount} msgs`)
      .join('\n');
    await chat.sendMessage(`🏆 Top Chatters:\n${list}`);
  },
};