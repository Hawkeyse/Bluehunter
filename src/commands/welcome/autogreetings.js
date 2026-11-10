const GroupSettings = require('../../models/GroupSettings');
const { COUNTRY_OFFSETS } = require('../../utils/countryOffsets');

const SUPPORTED_LIST = Object.keys(COUNTRY_OFFSETS).join(', ');

// Same 4 slots autoGreetingScheduler.js fires on - duplicated here (not
// imported) on purpose, just for the read-only /autogreetings status
// diagnostic below, so this file has zero effect on actual scheduling.
const SLOTS = [
  { key: 'morning', localHour: 8 },
  { key: 'afternoon', localHour: 13 },
  { key: 'evening', localHour: 18 },
  { key: 'night', localHour: 22 },
];

module.exports = {
  name: 'autogreetings',
  aliases: ['autogreeting'],
  category: 'welcome',
  description: `/autogreetings <country> [english|pidgin]|off|status - scheduled greetings (supported: ${SUPPORTED_LIST})`,
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const input = (args[0] || '').toLowerCase();

    if (!input) {
      return chat.sendMessage(`Usage: /autogreetings <country> [english|pidgin]|off|status\nExample: /autogreetings nigeria pidgin\nSupported countries: ${SUPPORTED_LIST}`);
    }

    if (input === 'off') {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { autoGreetingsEnabled: false }, { upsert: true });
      return chat.sendMessage('🌙 Auto-greetings are now DISABLED.');
    }

    // Diagnostic: shows exactly what the scheduler will actually use next -
    // the RAW stored country (so a wrong/stale value is visible, not
    // assumed), the offset it maps to, and the current server clock, so a
    // "posted at the wrong hour" report can be checked against real data
    // instead of guessed at from the code alone.
    if (input === 'status') {
      const settings = await GroupSettings.findOne({ groupId: chat.id._serialized });
      if (!settings || !settings.autoGreetingsEnabled) {
        return chat.sendMessage('🌙 Auto-greetings are currently OFF for this group.');
      }

      const rawCountry = settings.autoGreetingsCountry;
      const offset = COUNTRY_OFFSETS[rawCountry];
      const language = settings.autoGreetingsLanguage || 'english';
      const now = new Date();

      if (offset === undefined) {
        return chat.sendMessage(
          `⚠️ Stored country is "${rawCountry || '(empty)'}" - that's not a recognized key in COUNTRY_OFFSETS, so nothing will ever fire for this group.\n` +
          `Re-run /autogreetings <country> to fix it. Supported: ${SUPPORTED_LIST}`
        );
      }

      const nextSlots = SLOTS.map((slot) => {
        const utcHour = (((slot.localHour - offset) % 24) + 24) % 24;
        return `${slot.key}: fires at ${String(utcHour).padStart(2, '0')}:00 UTC (= ${String(slot.localHour).padStart(2, '0')}:00 in ${rawCountry})`;
      }).join('\n');

      return chat.sendMessage(
        `📊 Auto-greetings status for this group:\n\n` +
        `Stored country: "${rawCountry}"\n` +
        `Greeting language: ${language}\n` +
        `Offset in use: UTC${offset >= 0 ? '+' : ''}${offset}\n` +
        `Server clock right now: ${now.toISOString()} (${now.getUTCHours()}:${String(now.getUTCMinutes()).padStart(2, '0')} UTC)\n` +
        `Last slot sent: ${settings.lastGreetingSlot || '(none yet)'}\n\n` +
        `${nextSlots}\n\n` +
        `If the server clock above doesn't match real UTC time (check worldtimebuddy.com or similar), the host machine's system clock is the problem, not this code.`
      );
    }

    const language = (args[1] || 'english').toLowerCase();
    if (!['english', 'pidgin'].includes(language)) {
      return chat.sendMessage('Greeting language must be "english" or "pidgin". Example: /autogreetings nigeria pidgin');
    }

    if (!(input in COUNTRY_OFFSETS)) {
      return chat.sendMessage(`Unsupported country "${input}".\nSupported countries: ${SUPPORTED_LIST}`);
    }

    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { autoGreetingsEnabled: true, autoGreetingsCountry: input, autoGreetingsLanguage: language, lastGreetingSlot: '' },
      { upsert: true }
    );

    await chat.sendMessage(
      `☀️ Auto-greetings are now ENABLED for ${input.charAt(0).toUpperCase() + input.slice(1)} in ${language === 'pidgin' ? 'Nigerian Pidgin' : 'English'}.\n` +
      "I'll post good morning/afternoon/evening/night messages daily, timed to your local time."
    );
  },
};