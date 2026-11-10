const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'open',
  category: 'groupcontrol',
  description: '/open - everyone can send messages',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ chat }) {
    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { isOpen: true, reopenAt: null }, { upsert: true });
    try {
      await chat.setMessagesAdminsOnly(false);
    } catch (e) {}
    await chat.sendMessage('🔓 Group is now open. Everyone can send messages.');
  },
};
