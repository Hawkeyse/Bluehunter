const GroupSettings = require('../../models/GroupSettings');

const ALLOWED = ['/', '!', '.', '#', '$', '%', '&', '*'];

module.exports = {
  name: 'setprefix',
  category: 'chatcontrol',
  description: '/setprefix <char> - change command prefix for this group (e.g. / ! .)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const newPrefix = args[0];
    if (!newPrefix || newPrefix.length !== 1 || !ALLOWED.includes(newPrefix)) {
      return chat.sendMessage(`Usage: /setprefix <char>\nAllowed: ${ALLOWED.join(' ')}`);
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { prefix: newPrefix }, { upsert: true });
    await chat.sendMessage(`✅ Prefix changed to "${newPrefix}". Example: ${newPrefix}help`);
  },
};
