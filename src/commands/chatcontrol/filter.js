const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'filter',
  category: 'chatcontrol',
  description: '/filter badwords on|off - enable word filter (see also /badword and /badwordaction)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const [type, state] = args.map((a) => a.toLowerCase());
    if (type !== 'badwords' || !['on', 'off'].includes(state)) {
      return chat.sendMessage(
        'Usage: /filter badwords on|off\n\n' +
        'Use /badword add|remove|list to manage this group\'s own blocked words, ' +
        'and /badwordaction to set what happens when one is caught.'
      );
    }

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { filterBadwords: state === 'on' },
      { upsert: true }
    );
    await chat.sendMessage(`🧹 Bad word filter is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
