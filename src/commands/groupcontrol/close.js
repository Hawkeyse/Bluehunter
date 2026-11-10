const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'close',
  category: 'groupcontrol',
  description: '/close - only admins can chat',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ chat }) {
    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { isOpen: false, reopenAt: null }, { upsert: true });
    try {
      await chat.setMessagesAdminsOnly(true);
    } catch (e) {}
    await chat.sendMessage('🔒 Group is now closed. Only admins can chat.');
  },
};
