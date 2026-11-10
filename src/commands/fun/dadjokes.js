const GroupSettings = require('../../models/GroupSettings');
const { JOKE_DEFAULT_TIME_UTC } = require('../../config');

function parseTimeToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

module.exports = {
  name: 'dadjokes',
  category: 'fun',
  description: `/dadjokes on [HH:mm]|off - daily scheduled dad joke, posted once a day (default ${JOKE_DEFAULT_TIME_UTC} UTC). For one right now, see /joke.`,
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const input = (args[0] || '').toLowerCase();

    if (input === 'off') {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { jokesEnabled: false }, { upsert: true });
      return chat.sendMessage('😂 Daily dad joke is now DISABLED.');
    }

    if (input !== 'on') {
      return chat.sendMessage(
        `Usage: /dadjokes on [HH:mm]|off\n` +
        `HH:mm is 24-hour UTC time (e.g. 09:00). Leave it out to use the default of ${JOKE_DEFAULT_TIME_UTC} UTC.\n` +
        `Want mom jokes instead? Use /momjokes - a group only gets one daily joke schedule, whichever you turned on most recently.`
      );
    }

    const timeArg = args[1] || '';
    let time = '';
    if (timeArg) {
      if (parseTimeToMinutes(timeArg) === null) {
        return chat.sendMessage("⚠️ That time isn't valid. Use 24-hour UTC format, e.g. /dadjokes on 09:00");
      }
      time = timeArg;
    }

    // Resetting lastJokeDate means a type/time change (or first enable)
    // takes effect immediately, instead of waiting on a stale marker from
    // whatever the previous time/day was.
    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { jokesEnabled: true, jokesType: 'dad', jokesTime: time, lastJokeDate: '' },
      { upsert: true }
    );

    await chat.sendMessage(
      `😂 Daily dad joke is now ENABLED, posting once a day at ${time || JOKE_DEFAULT_TIME_UTC} UTC.\n` +
      'Want one right now instead of waiting? Try /joke.'
    );
  },
};
