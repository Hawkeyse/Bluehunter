const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antilink',
  category: 'groupcontrol',
  description: '/antilink on|off - block links (WhatsApp group invites + any other URL) (see also /antilinkignore and /antilinkaction)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) {
      return chat.sendMessage(
        'Usage: /antilink on|off\n\n' +
        'Blocks WhatsApp group invite links AND any other link (tiktok.com, instagram.com, etc).\n' +
        'Use /antilinkignore add|remove|list to whitelist specific links/domains (e.g. this group\'s own invite link), ' +
        'and /antilinkaction to set what happens when one is caught.'
      );
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antilink: state === 'on' }, { upsert: true });
    await chat.sendMessage(`🔗 Antilink is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
