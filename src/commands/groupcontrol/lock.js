const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'lock',
  category: 'groupcontrol',
  description: '/lock - lock group settings (admins only edits: name, icon, description)',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ chat }) {
    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { isLocked: true }, { upsert: true });
    try {
      await chat.setInfoAdminsOnly(true);
    } catch (e) {}
    await chat.sendMessage('🔒 Group info is now locked. Only admins can edit name/icon/description.');
  },
};
