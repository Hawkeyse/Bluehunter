module.exports = {
  name: 'admins',
  category: 'groupmanagement',
  description: '/admins - list all admins',
  groupOnly: true,
  async execute({ chat }) {
    const admins = chat.participants.filter((p) => p.isAdmin || p.isSuperAdmin);
    if (admins.length === 0) return chat.sendMessage('No admins found (unexpected).');

    const mentions = admins.map((a) => a.id._serialized);
    const list = admins.map((a, i) => `${i + 1}. @${a.id.user}`).join('\n');
    await chat.sendMessage(`👮 Group Admins (${admins.length}):\n${list}`, { mentions });
  },
};
