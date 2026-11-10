const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antibot',
  category: 'groupcontrol',
  description: '/antibot on|off - catch other bots in the group (admins are exempt; uses the /antilinkaction setting)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) {
      return chat.sendMessage(
        'Usage: /antibot on|off\n\n' +
        'Catches other bots that people bring into the group so their commands are not used here. ' +
        'Bots that are group admins are left alone.\n' +
        'What happens to a caught bot follows /antilinkaction (delete, warn, strike or kick).\n\n' +
        'Note: bots are spotted by how their messages are built, so a few bots can slip through.'
      );
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { antibot: state === 'on' }, { upsert: true });
    await chat.sendMessage(`🤖 Antibot is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};
