const fs = require('fs');
const { LOG_FILE } = require('../../utils/logger');

module.exports = {
  name: 'logs',
  category: 'system',
  description: '/logs - error/activity logs (last 30 lines)',
  ownerOnly: true,
  async execute({ msg }) {
    if (!fs.existsSync(LOG_FILE)) return msg.reply('No logs recorded yet.');

    const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
    const last30 = lines.slice(-30).join('\n');
    const chunk = last30.length > 4000 ? last30.slice(-4000) : last30;

    await msg.reply(`🧾 Last log lines:\n\`\`\`${chunk}\`\`\``);
  },
};
