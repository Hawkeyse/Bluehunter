const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'badword',
  category: 'chatcontrol',
  description: '/badword add|remove|list <word> - manage this group\'s own blocked words (on top of the built-in filter)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const sub = (args[0] || '').toLowerCase();
    const settings = await GroupSettings.getOrCreate(chat.id._serialized);

    if (sub === 'list') {
      if (!settings.customBadwords.length) return chat.sendMessage('No custom blocked words set for this group.');
      return chat.sendMessage(`🚫 Custom blocked words:\n${settings.customBadwords.map((w) => `• ${w}`).join('\n')}`);
    }

    if (!['add', 'remove'].includes(sub)) {
      return chat.sendMessage('Usage: /badword add <word> | /badword remove <word> | /badword list');
    }

    const word = args.slice(1).join(' ').toLowerCase().trim();
    if (!word) return chat.sendMessage('Usage: /badword add <word> | /badword remove <word> | /badword list');

    if (sub === 'add') {
      if (settings.customBadwords.includes(word)) return chat.sendMessage(`"${word}" is already blocked.`);
      settings.customBadwords.push(word);
      await settings.save();
      return chat.sendMessage(
        `🚫 Added "${word}" to this group's blocked words.` +
        (settings.filterBadwords ? '' : '\n⚠️ The filter is currently off - turn it on with /filter badwords on')
      );
    }

    // remove
    if (!settings.customBadwords.includes(word)) return chat.sendMessage(`"${word}" isn't in the blocked list.`);
    settings.customBadwords = settings.customBadwords.filter((w) => w !== word);
    await settings.save();
    await chat.sendMessage(`✅ Removed "${word}" from this group's blocked words.`);
  },
};
