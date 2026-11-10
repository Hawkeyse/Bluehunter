const GroupSettings = require('../../models/GroupSettings');
const { extractInviteCodes } = require('../../utils/antilink');

module.exports = {
  name: 'antilinkignore',
  category: 'groupcontrol',
  description: '/antilinkignore add|remove|list <link|domain> - links/domains antilink should let through (e.g. this group\'s own invite link, or youtube.com)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const sub = (args[0] || '').toLowerCase();
    const settings = await GroupSettings.getOrCreate(chat.id._serialized);

    if (sub === 'list') {
      if (!settings.antilinkWhitelist.length) return chat.sendMessage('No whitelisted links for this group yet.');
      return chat.sendMessage(`🔗 Whitelisted for antilink:\n${settings.antilinkWhitelist.map((w) => `• ${w}`).join('\n')}`);
    }

    if (!['add', 'remove'].includes(sub)) {
      return chat.sendMessage('Usage: /antilinkignore add <link> | /antilinkignore remove <link> | /antilinkignore list');
    }

    const input = args.slice(1).join(' ').trim();
    if (!input) return chat.sendMessage('Usage: /antilinkignore add <link> | /antilinkignore remove <link> | /antilinkignore list');

    const code = extractInviteCodes(input)[0] || input.toLowerCase();

    if (sub === 'add') {
      if (settings.antilinkWhitelist.includes(code)) return chat.sendMessage('That link is already whitelisted.');
      settings.antilinkWhitelist.push(code);
      await settings.save();
      return chat.sendMessage(`✅ That link is now whitelisted - antilink will let it through.`);
    }

    // remove
    if (!settings.antilinkWhitelist.includes(code)) return chat.sendMessage("That link isn't whitelisted.");
    settings.antilinkWhitelist = settings.antilinkWhitelist.filter((w) => w !== code);
    await settings.save();
    await chat.sendMessage('✅ Removed that link from the whitelist.');
  },
};
