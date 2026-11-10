const GroupSettings = require('../../models/GroupSettings');
const { JOKE_DEFAULT_TIME_UTC } = require('../../config');

function parseTimeToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

module.exports = {
  name: 'momjokes',
  category: 'fun',
  description: `/momjokes on [HH:mm]|off - daily scheduled "yo mama" joke, posted once a day (default ${JOKE_DEFAULT_TIME_UTC} UTC). For one right now, see /joke.`,
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const input = (args[0] || '').toLowerCase();

    if (input === 'off') {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { jokesEnabled: false }, { upsert: true });
      return chat.sendMessage('😂 Daily mom joke is now DISABLED.');
    }

    if (input !== 'on') {
      return chat.sendMessage(
        `Usage: /momjokes on [HH:mm]|off\n` +
        `HH:mm is 24-hour UTC time (e.g. 09:00). Leave it out to use the default of ${JOKE_DEFAULT_TIME_UTC} UTC.\n` +
        `Want dad jokes instead? Use /dadjokes - a group only gets one daily joke schedule, whichever you turned on most recently.`
      );
    }

    const timeArg = args[1] || '';
    let time = '';
    if (timeArg) {
      if (parseTimeToMinutes(timeArg) === null) {
        return chat.sendMessage("⚠️ That time isn't valid. Use 24-hour UTC format, e.g. /momjokes on 09:00");
      }
      time = timeArg;
    }

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { jokesEnabled: true, jokesType: 'mom', jokesTime: time, lastJokeDate: '' },
      { upsert: true }
    );

    await chat.sendMessage(
      `😂 Daily mom joke is now ENABLED, posting once a day at ${time || JOKE_DEFAULT_TIME_UTC} UTC.\n` +
      'Want one right now instead of waiting? Try /joke.'
    );
  },
};
