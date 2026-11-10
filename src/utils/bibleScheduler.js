const GroupSettings = require('../models/GroupSettings');
const { getGroupMetadataCached } = require('./waCompat');
const { getRandomVerse } = require('./bibleService');
const { getAiReply } = require('./openaiClient');
const { correctedNow } = require('./serverClock');
const { BIBLE_DEFAULT_TIME_UTC, BIBLE_CHECK_INTERVAL_MS, BIBLE_MENTION_ALL } = require('../config');
const logger = require('./logger');

// Used only if OpenAI is unavailable/unset/fails - the verse itself still
// posts either way, just without the reflection line.
const REFLECTION_SYSTEM_PROMPT = `Write one brief, thoughtful reflection (one sentence, at most 25 words) to accompany a Bible verse in a WhatsApp group. Make it meaningful, gently encouraging, and grounded in the verse's actual message; offer hope without promising that every problem will disappear. Do not alter, repeat, paraphrase, or "correct" the verse, and do not invent other scripture. No greeting or sign-off - only the reflection.`;

/** "HH:mm" -> minutes since midnight, or null if malformed. */
function parseTimeToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function todayUtcDateKey(now) {
  return now.toISOString().slice(0, 10);
}

async function buildVerseMessage(verse) {
  const reflection = await getAiReply(REFLECTION_SYSTEM_PROMPT, `Reference: ${verse.reference}\nText: "${verse.text}"`);
  let text = `📖 *Verse of the Day*\n\n_"${verse.text}"_\n— *${verse.reference}* (${verse.translation})`;
  if (reflection) text += `\n\n${reflection}`;
  return text;
}

function startBibleScheduler(sock) {
  // Same overlap guard as autoGreetingScheduler.js - see the comment there.
  let tickInProgress = false;

  setInterval(async () => {
    if (tickInProgress) {
      logger.warn('Bible scheduler: previous tick still running, skipping this interval.');
      return;
    }
    tickInProgress = true;
    try {
      const now = correctedNow();
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const dateKey = todayUtcDateKey(now);

      const groups = await GroupSettings.find({ bibleEnabled: true });
      for (const group of groups) {
        try {
          if (group.lastBibleQuoteDate === dateKey) continue; // already posted today

          const targetMinutes = parseTimeToMinutes(group.bibleTime) ?? parseTimeToMinutes(BIBLE_DEFAULT_TIME_UTC);
          if (targetMinutes !== nowMinutes) continue;

          const verse = await getRandomVerse(group.bibleVersion);
          if (!verse) continue; // Bible API hiccup - try again next tick, still same slot since date hasn't changed

          const text = await buildVerseMessage(verse);

          // "Pingable" - mention every current member so the daily verse
          // actually notifies people, same pattern as /admins and /members.
          // Off by default (BIBLE_MENTION_ALL=1 turns it back on): pinging
          // every member of every group daily is what gets a bot number
          // reported and blocked.
          let mentions = [];
          if (BIBLE_MENTION_ALL) {
            const metadata = await getGroupMetadataCached(sock, group.groupId);
            mentions = (metadata?.participants || []).map((p) => p.id);
          }

          await sock.sendMessage(group.groupId, { text, mentions });

          group.lastBibleQuoteDate = dateKey;
          await group.save();
        } catch (err) {
          logger.warn('Bible scheduler failed for group', group.groupId, '-', err.message);
        }
      }
    } catch (err) {
      logger.error('Bible scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, BIBLE_CHECK_INTERVAL_MS);
}

module.exports = { startBibleScheduler };
