const { getTargetUser, numberToJid } = require('../../utils/mentions');

module.exports = {
  name: 'decline',
  category: 'groupmanagement',
  description: '/decline @user | 233xxxxxxxxx | all - reject pending join request(s)',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ msg, chat, args }) {
    let requests;
    try {
      requests = await chat.getGroupMembershipRequests();
    } catch (err) {
      return msg.reply('❌ Could not fetch join requests. Make sure "Admin approval" is enabled for this group and I\'m an admin.');
    }

    if (!requests || requests.length === 0) return msg.reply('No pending join requests right now.');

    let targetIds;
    if ((args[0] || '').toLowerCase() === 'all') {
      targetIds = requests.map((r) => r.id._serialized);
    } else {
      let target = await getTargetUser(msg);
      if (!target && args[0]) target = numberToJid(args[0]);
      if (!target) return msg.reply('Usage: /decline @user, /decline 233xxxxxxxxx, or /decline all');
      targetIds = [target];
    }

    try {
      await chat.rejectGroupMembershipRequests(targetIds);
      const mentions = targetIds;
      const label = targetIds.length > 1 ? `${targetIds.length} members` : `@${targetIds[0].split('@')[0]}`;
      await chat.sendMessage(`🚫 Declined ${label}'s request to join.`, { mentions });
    } catch (err) {
      await msg.reply('❌ Failed to decline. They may have already been handled or left.');
    }
  },
};
