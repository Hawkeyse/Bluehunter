module.exports = {
  name: 'requests',
  category: 'groupmanagement',
  description: '/requests - list pending join requests waiting for admin approval',
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat }) {
    let requests;
    try {
      requests = await chat.getGroupMembershipRequests();
    } catch (err) {
      return msg.reply('❌ Could not fetch join requests. Make sure "Admin approval" is enabled for this group.');
    }

    if (!requests || requests.length === 0) return msg.reply('No pending join requests right now.');

    const mentions = requests.map((r) => r.id._serialized);
    const list = requests.map((r, i) => `${i + 1}. @${r.id.user}`).join('\n');
    await chat.sendMessage(
      `📋 Pending join requests (${requests.length}):\n${list}\n\nUse /approve all or /decline all, or /approve @user for one specifically.`,
      { mentions }
    );
  },
};
