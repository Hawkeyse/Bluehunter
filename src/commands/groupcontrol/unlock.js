const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'unlock',
  category: 'groupcontrol',
  description: '/unlock - allow edits again',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ chat }) {
    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { isLocked: false }, { upsert: true });
    try {
      await chat.setInfoAdminsOnly(false);
    } catch (e) {}
    await chat.sendMessage('🔓 Group info is now unlocked. Everyone can edit name/icon/description.');
  },
};
