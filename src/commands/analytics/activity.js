const Activity = require('../../models/Activity');
const GroupDailyActivity = require('../../models/GroupDailyActivity');
const reportCooldown = require('../../utils/reportCooldown');
const logger = require('../../utils/logger');
const { lineChartPng } = require('../../utils/activityChart');

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes, shared across the whole group

module.exports = {
  name: 'activity',
  category: 'analytics',
  description: '/activity - active users report (last 7 days, 5min cooldown per group)',
  groupOnly: true,
  async execute({ chat, client }) {
    const groupId = chat.id._serialized;
    const remaining = reportCooldown.getRemaining('activity', groupId, COOLDOWN_MS);
    if (remaining > 0) {
      return chat.sendMessage(`⏳ /activity was just run in this group. Try again in ${Math.ceil(remaining / 60000)}m.`);
    }
    reportCooldown.trigger('activity', groupId);

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const active = await Activity.find({ groupId, lastMessageAt: { $gte: since } })
      .sort({ messageCount: -1 })
      .limit(20);

    if (active.length === 0) return chat.sendMessage('No activity recorded in the last 7 days yet.');

    // Line graph of group messages per day (UTC days), sent before the list.
    // If drawing it fails for any reason the text list below still goes out.
    try {
      const days = [];
      for (let i = 6; i >= 0; i--) days.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
      const keys = days.map((d) => d.toISOString().slice(0, 10));
      const rows = await GroupDailyActivity.find({ groupId, date: { $in: keys } }).select('date count').lean();
      const byDate = new Map(rows.map((r) => [r.date, r.count]));
      const points = days.map((d, i) => ({ label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), value: byDate.get(keys[i]) || 0 }));
      const total = points.reduce((n, p) => n + p.value, 0);
      if (total > 0) {
        const peak = points.reduce((a, b) => (b.value > a.value ? b : a));
        const png = await lineChartPng(points, { title: 'Group messages, last 7 days' });
        await client.sendMessage(groupId, { image: png, mimetype: 'image/png', caption: `📈 ${total.toLocaleString()} messages this week. Busiest day: ${peak.label} (${peak.value}).` });
      }
    } catch (err) {
      logger.warn(`/activity graph failed: ${err.message}`);
    }

    // Fall back to the number if we never captured a pushName for this user
    // (e.g. all their messages came through before this tracking existed).
    const list = active
      .map((a, i) => `${i + 1}. ${a.displayName || a.userId.split('@')[0]} - ${a.messageCount} msgs`)
      .join('\n');
    await chat.sendMessage(`📈 Active users (last 7 days):\n${list}`);
  },
};