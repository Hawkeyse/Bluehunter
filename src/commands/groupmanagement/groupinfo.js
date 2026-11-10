const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'groupinfo',
  category: 'groupmanagement',
  description: '/groupinfo - group details',
  groupOnly: true,
  async execute({ chat }) {
    const settings = await GroupSettings.getOrCreate(chat.id._serialized);
    const admins = chat.participants.filter((p) => p.isAdmin || p.isSuperAdmin).length;

    const text = [
      `📋 *${chat.name}*`,
      chat.description ? `_${chat.description}_` : '',
      '',
      `👥 Members: ${chat.participants.length}`,
      `👮 Admins: ${admins}`,
      `📅 Created: ${chat.createdAt ? new Date(chat.createdAt * 1000).toLocaleDateString() : 'Unknown'}`,
      '',
      `⚙️ Settings`,
      `• Prefix: ${settings.prefix}`,
      `• Open: ${settings.isOpen ? 'Yes' : 'No'}`,
      `• Locked: ${settings.isLocked ? 'Yes' : 'No'}`,
      `• Antilink: ${settings.antilink ? 'On' : 'Off'}`,
      `• Antispam: ${settings.antispam ? 'On' : 'Off'}`,
      `• Antiflood: ${settings.antiflood ? 'On' : 'Off'}`,
      `• Welcome: ${settings.welcomeEnabled ? 'On' : 'Off'}`,
      `• Goodbye: ${settings.goodbyeEnabled ? 'On' : 'Off'}`,
    ]
      .filter(Boolean)
      .join('\n');

    await chat.sendMessage(text);
  },
};
