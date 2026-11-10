const GroupSettings = require('../../models/GroupSettings');
const { COUNTRY_OFFSETS } = require('../../utils/countryOffsets');

const SUPPORTED_LIST = ['utc', ...Object.keys(COUNTRY_OFFSETS)].join(', ');
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

module.exports = {
  name: 'autolock',
  aliases: ['scheduledlock'],
  category: 'groupcontrol',
  description: `/autolock <closeTime> <openTime> <utc|country>|off - schedule daily close/open (e.g. /autolock 05:00 07:00 nigeria). Supported zones: ${SUPPORTED_LIST}`,
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ chat, args }) {
    if ((args[0] || '').toLowerCase() === 'off') {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { scheduledLockEnabled: false }, { upsert: true });
      return chat.sendMessage('⏹️ Scheduled close/open is now DISABLED.');
    }

    const [closeTime, openTime, zoneRaw] = args;
    const zone = (zoneRaw || '').toLowerCase();

    if (!closeTime || !openTime || !zone) {
      return chat.sendMessage(
        `Usage: /autolock <closeTime> <openTime> <utc|country>|off\n` +
        `e.g. /autolock 05:00 07:00 nigeria\n` +
        `Supported zones: ${SUPPORTED_LIST}`
      );
    }

    if (!TIME_RE.test(closeTime) || !TIME_RE.test(openTime)) {
      return chat.sendMessage('Times must be in 24-hour HH:mm format, e.g. 05:00 or 22:30.');
    }

    if (zone !== 'utc' && !(zone in COUNTRY_OFFSETS)) {
      return chat.sendMessage(`Unsupported zone "${zone}".\nSupported zones: ${SUPPORTED_LIST}`);
    }

    // Reset the per-day dedupe trackers so a changed time takes effect
    // immediately instead of waiting on a marker left by the previous time.
    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      {
        scheduledLockEnabled: true,
        scheduledCloseTime: closeTime,
        scheduledOpenTime: openTime,
        scheduledLockZone: zone,
        lastScheduledCloseWarnDate: '',
        lastScheduledCloseDate: '',
        lastScheduledOpenWarnDate: '',
        lastScheduledOpenDate: '',
      },
      { upsert: true }
    );

    await chat.sendMessage(
      `🔒 Scheduled close/open is now ENABLED.\n` +
      `Closes daily at ${closeTime} (${zone}), with a 5-minute warning first.\n` +
      `Opens daily at ${openTime} (${zone}), also with a 5-minute warning first.`
    );
  },
};