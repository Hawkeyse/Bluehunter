module.exports = {
  name: 'members',
  category: 'groupmanagement',
  description: '/members - list all members',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat }) {
    const members = chat.participants;
    if (members.length === 0) return chat.sendMessage('No members found (unexpected).');

    // WhatsApp caps mentions/message length in practice, so chunk if the group is large
    const CHUNK = 100;
    for (let i = 0; i < members.length; i += CHUNK) {
      const slice = members.slice(i, i + CHUNK);
      const mentions = slice.map((m) => m.id._serialized);
      const list = slice.map((m, idx) => `${i + idx + 1}. @${m.id.user}${m.isAdmin || m.isSuperAdmin ? ' (admin)' : ''}`).join('\n');
      await chat.sendMessage(`👥 Members ${i + 1}-${i + slice.length} of ${members.length}:\n${list}`, { mentions });
    }
  },
};
