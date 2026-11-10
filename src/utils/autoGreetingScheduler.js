const GroupSettings = require('../models/GroupSettings');
const { COUNTRY_OFFSETS } = require('./countryOffsets');
const { getGroupMetadataCached } = require('./waCompat');
const { getAiReply } = require('./openaiClient');
const { correctedNow } = require('./serverClock');
const { AUTO_GREETING_CHECK_INTERVAL_MS } = require('../config');
const logger = require('./logger');

// Fixed LOCAL-time schedule. Each group's country offset converts this into
// the UTC hour to actually fire at - e.g. Nigeria (UTC+1): 08:00 local ->
// 07:00 UTC, 13:00 -> 12:00 UTC, 18:00 -> 17:00 UTC, 22:00 -> 21:00 UTC.
const SLOTS = [
  { key: 'morning', localHour: 8, header: 'Good morning', emoji: '☀️' },
  { key: 'afternoon', localHour: 13, header: 'Good afternoon', emoji: '☀️' },
  { key: 'evening', localHour: 18, header: 'Good evening', emoji: '🌙' },
  { key: 'night', localHour: 22, header: 'Good night', emoji: '😴' },
];

// Used only if OpenAI is unavailable/unset/fails - keeps the feature working
// even without an API key, just without the daily variety.
const FALLBACK_BODIES = {
  morning: "Hope you're all doing well and ready for a productive day. Wishing everyone success, good health, and positive vibes. Let's make today a great one! 💪😊",
  afternoon: "Hope your day is going smoothly. Keep pushing—stay focused, stay positive, and let's finish strong today 💪😊",
  evening: "Hope your day went well. Take a moment to relax and unwind. Let's wrap up the day peacefully and come back stronger tomorrow 💪😊",
  night: 'Hope you all had a great day. Time to rest, relax, and recharge. Wishing you a peaceful night and sweet dreams 😴💤',
};

const PIDGIN_FALLBACK_BODIES = {
  morning: 'Una don wake? Make today bring better news, clear road, and small money wey no get stress join. God guide una steps today o. 🙏🏾☀️',
  afternoon: 'Abeg take small water break, no let work use you do shift work. You don try reach this afternoon—make the rest of today soft for you. 💧😄',
  evening: 'Omo, you don reach evening; drop the wahala wey no fit follow you go house. Make your mind rest and tomorrow carry better gist. 🌆🙏🏾',
  night: 'No carry today matter go wrestle for bed. Sleep well, recharge; tomorrow get another chance to do better. Good night o. 😴🙏🏾',
};

const PIDGIN_HEADERS = {
  morning: 'Una good morning o',
  afternoon: 'Una good afternoon o',
  evening: 'Una good evening o',
  night: 'Make una sleep well o',
};

function buildGreetingSystemPrompt(language) {
  const pidgin = language === 'pidgin';
  return `Write the body text for a scheduled ${pidgin ? 'Nigerian Pidgin' : 'English'} good-morning/afternoon/evening/night message posted to a WhatsApp community group. ${
    pidgin
      ? 'Use natural Nigerian Pidgin (not a word-for-word English translation); sound warm, familiar, and fluent.'
      : 'Use natural, warm English.'
  } Create variety across these moods: sometimes funny and light, sometimes thoughtful/deep, sometimes a short prayer or blessing, sometimes encouraging. Choose only one mood per greeting and fit it to the time of day. Keep it sincere and suitable for a mixed group; do not make every message religious or every message a joke. Use 1-3 short sentences and 1-2 fitting emoji. Never start with a salutation - that part is added separately. Never mention anyone by name or call the group "group". Vary the wording and structure; do not repeat the same sentence twice in a row.`;
}

async function buildGreetingText(slot, groupName, language = 'english') {
  const pidgin = language === 'pidgin';
  const body = await getAiReply(
    buildGreetingSystemPrompt(language),
    `Write a ${pidgin ? 'Nigerian Pidgin' : 'English'} ${slot.key} greeting now. Pick one suitable mood: funny, thoughtful/deep, prayer/blessing, or encouraging.`
  );
  const fallback = pidgin ? PIDGIN_FALLBACK_BODIES[slot.key] : FALLBACK_BODIES[slot.key];
  const header = pidgin ? PIDGIN_HEADERS[slot.key] : slot.header;
  return `${header}! ${slot.emoji}\n*${groupName}*\n\n${(body || fallback).trim()}`;
}

function todayUtcDateKey(now) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

function startAutoGreetingScheduler(sock) {
  // Guards against this tick still being mid-run (e.g. a slow OpenAI call
  // for one of several groups) when the next interval fires - without this,
  // two overlapping ticks could both decide the same group's slot hasn't
  // been sent yet (since the first tick hasn't saved lastGreetingSlot yet)
  // and post the greeting twice. Same class of bug as a Mongoose
  // VersionError from a genuine save-race, just prevented at the source
  // instead of recovered from after the fact.
  let tickInProgress = false;
  const sentToday = new Map(); // groupId -> Set<slotId>

  setInterval(async () => {
    if (tickInProgress) {
      logger.warn('Auto-greeting scheduler: previous tick still running, skipping this interval.');
      return;
    }
    tickInProgress = true;
    try {
      const now = correctedNow();
      const utcHour = now.getUTCHours();
      const dateKey = todayUtcDateKey(now);

      const groups = await GroupSettings.find({ autoGreetingsEnabled: true });
      for (const group of groups) {
        try {
          const offset = COUNTRY_OFFSETS[group.autoGreetingsCountry];
          if (offset === undefined) continue; // no/invalid country set - nothing to schedule against

          const matchedSlot = SLOTS.find((slot) => (((slot.localHour - offset) % 24) + 24) % 24 === utcHour);
          if (!matchedSlot) continue;

          const slotId = `${dateKey}-${matchedSlot.key}`;
          const groupSent = sentToday.get(group.groupId) || new Set();
          if (group.lastGreetingSlot === slotId || groupSent.has(slotId)) continue; // already sent this slot today

          const metadata = await getGroupMetadataCached(sock, group.groupId);
          const groupName = metadata?.subject || 'This group';

          const text = await buildGreetingText(matchedSlot, groupName, group.autoGreetingsLanguage || 'english');
          await sock.sendMessage(group.groupId, { text });

          groupSent.add(slotId);
          sentToday.set(group.groupId, groupSent);
          group.lastGreetingSlot = slotId;
          await group.save();
        } catch (err) {
          logger.warn('Auto-greeting failed for group', group.groupId, '-', err.message);
        }
      }
    } catch (err) {
      logger.error('Auto-greeting scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, AUTO_GREETING_CHECK_INTERVAL_MS);
}

module.exports = { startAutoGreetingScheduler, buildGreetingText, buildGreetingSystemPrompt };