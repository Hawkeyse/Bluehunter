const GroupSettings = require('../../models/GroupSettings');
const { BIBLE_DEFAULT_TIME_UTC } = require('../../config');

function parseTimeToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

module.exports = {
  name: 'bible',
  aliases: ['dailyverse', 'verseoftheday'],
  category: 'bible',
  description: `/bible on [HH:mm]|off - daily scheduled Bible verse, posted once a day and @everyone-tagged (default ${BIBLE_DEFAULT_TIME_UTC} UTC). For in-chat verse lookup (e.g. "John 3:16"), see /versedetect instead.`,
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const input = (args[0] || '').toLowerCase();

    if (input === 'off') {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { bibleEnabled: false }, { upsert: true });
      return chat.sendMessage('📖 Daily Bible verse is now DISABLED.');
    }

    if (input !== 'on') {
      return chat.sendMessage(
        `Usage: /bible on [HH:mm]|off\n` +
        `HH:mm is 24-hour UTC time (e.g. 13:00). Leave it out to use the default of ${BIBLE_DEFAULT_TIME_UTC} UTC.`
      );
    }

    const timeArg = args[1] || '';
    let time = '';
    if (timeArg) {
      if (parseTimeToMinutes(timeArg) === null) {
        return chat.sendMessage('⚠️ That time isn\'t valid. Use 24-hour UTC format, e.g. /bible on 13:00');
      }
      time = timeArg;
    }

    // Resetting lastBibleQuoteDate means a time change (or first enable)
    // takes effect immediately, instead of waiting on a stale marker from
    // whatever the previous time/day was.
    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { bibleEnabled: true, bibleTime: time, lastBibleQuoteDate: '' },
      { upsert: true }
    );

    await chat.sendMessage(
      `📖 Daily Bible verse is now ENABLED, posting once a day at ${time || BIBLE_DEFAULT_TIME_UTC} UTC and tagging everyone.\n` +
      'Want a verse right now instead of waiting? Try /verse.'
    );
  },
};
