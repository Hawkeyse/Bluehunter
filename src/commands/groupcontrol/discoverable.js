const GroupSettings = require('../../models/GroupSettings');
const { invalidateGroupCaches } = require('../../web/server');

module.exports = {
  name: 'discoverable',
  category: 'groupcontrol',
  description: '/discoverable on|off - allow or hide the group invite in BlueHunter Discover',
  adminOnly: true,
  groupOnly: true,
  async execute({ client, chat, args }) {
    const state = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(state)) {
      return chat.sendMessage('Usage: /discoverable on|off\nAdmins can let people find and request to join this group from BlueHunter Discover.');
    }

    const groupId = chat.id._serialized;
    if (state === 'on') {
      if (typeof client.groupInviteCode !== 'function') {
        return chat.sendMessage('I cannot retrieve a WhatsApp invite link right now. Please try again later.');
      }

      try {
        const code = await client.groupInviteCode(groupId);
        if (!code) throw new Error('WhatsApp returned no invite code');
      } catch (err) {
        return chat.sendMessage('I could not check this group’s invite link. Make sure BlueHunter can access the group invite, then try again.');
      }
    }

    await GroupSettings.findOneAndUpdate(
      { groupId },
      { directoryDiscoverable: state === 'on' },
      { upsert: true }
    );
    invalidateGroupCaches();
    await chat.sendMessage(
      state === 'on'
        ? '🔎 This group is now discoverable. Its WhatsApp invite is shown only after visitors accept the join notice.'
        : '🔒 This group’s invite is now hidden from BlueHunter Discover.'
    );
  },
};
