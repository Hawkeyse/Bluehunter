const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'antiviewonce',
  category: 'groupcontrol',
  description: '/antiviewonce on|off - reveal view-once photos/videos back into the group (applies to everyone, including admins)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) return chat.sendMessage('Usage: /antiviewonce on|off');

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { antiviewonce: state === 'on' },
      { upsert: true }
    );
    await chat.sendMessage(`👁️ Antiviewonce is now ${state === 'on' ? 'ENABLED' : 'DISABLED'}.`);
  },
};