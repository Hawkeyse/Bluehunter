const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'allownsfw',
  category: 'system',
  description:
    '/allownsfw <groupId> on|off - opt a group out of the auto-leave-on-NSFW check (see /safetyflags for ids). Does NOT affect the sexual/minors zero-tolerance check, which always applies regardless.',
  ownerOnly: true,
  async execute({ msg, args }) {
    const groupId = args[0];
    const setting = (args[1] || '').toLowerCase();
    if (!groupId || !['on', 'off'].includes(setting)) {
      return msg.reply('Usage: /allownsfw <groupId> on|off');
    }

    const result = await GroupSettings.findOneAndUpdate(
      { groupId },
      { nsfwAllowed: setting === 'on' },
      { upsert: true, new: true }
    );

    await msg.reply(
      setting === 'on'
        ? `✅ NSFW allowed for ${result.groupId}. BlueHunter will no longer auto-leave that group for general adult content - the sexual/minors safety check still always applies.`
        : `✅ NSFW no longer allowed for ${result.groupId}. Normal auto-leave-on-NSFW behavior restored.`
    );
  },
};
