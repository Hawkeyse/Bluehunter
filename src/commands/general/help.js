const { BOT_NAME } = require('../../config');
const { BOT_START_TIME, getRelativeTime } = require('../../utils/botMeta');

const CATEGORY_LABELS = {
  moderation: '👮‍♂️ Moderation',
  groupcontrol: '🔐 Group Control',
  groupmanagement: '👥 Group Management',
  chatcontrol: '💬 Chat Control',
  welcome: '👋 Welcome / Goodbye',
  analytics: '📊 Analytics',
  downloader: '⬇️ Downloader',
  bible: '📖 Bible',
  fun: '😂 Fun',
  youtube: '📺 YouTube Alerts',
  xalert: '🐦 X Alerts',
  system: '⚙️ System (Owner Only)',
  general: 'ℹ️ General',
};

const COMING_SOON = [];

module.exports = {
  name: 'help',
  aliases: ['menu', 'commands'],
  category: 'general',
  description: "/help [category] - show the menu, or a category's commands (e.g. /help moderation)",
  async execute({ msg, args }) {
    // pull the loaded command list off the module cache to avoid circular imports
    const { loadCommands } = require('../../handlers/commandHandler');
    const commands = loadCommands();

    const byCategory = {};
    for (const command of new Set(commands.values())) {
      if (!byCategory[command.category]) byCategory[command.category] = [];
      byCategory[command.category].push(command);
    }

    const requested = (args[0] || '').toLowerCase();

    // /help <category> - full command list for just that one category, so
    // people aren't dumped the entire menu every time they type /help.
    if (requested) {
      if (!byCategory[requested]) {
        return msg.reply(`No category called "${requested}". Type /help to see the list of categories.`);
      }

      const cmds = byCategory[requested].sort((a, b) => a.name.localeCompare(b.name));
      const text =
        `${CATEGORY_LABELS[requested] || requested}\n` +
        '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n' +
        cmds.map((c) => `◈ ${c.description}`).join('\n') +
        '\n\nType /help to go back to the main menu.';
      return msg.reply(text);
    }

    // /help with no args - compact menu (category names + counts only), not
    // a full command dump.
    let text =
      '╭─────────────────╮\n' +
      `   🔷 *${BOT_NAME.toUpperCase()}* 🔷\n` +
      '╰─────────────────╯\n' +
      '👤 Created by: *Timtech*\n' +
      `🕓 Last updated: Today, ${getRelativeTime(BOT_START_TIME)}\n` +
      '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n' +
      '📋 *Menu* - type /help <category> to see its commands\n\n';

    for (const [category, cmds] of Object.entries(byCategory)) {
      text += `${CATEGORY_LABELS[category] || category} (${cmds.length})\n`;
    }

    if (COMING_SOON.length) {
      text += '\n🔮 *Coming Soon*\n';
      text += COMING_SOON.map((f) => `  ◈ ${f}`).join('\n');
    }
    text += '\n\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n✧ e.g. /help moderation ✧';

    await msg.reply(text);
  },
};