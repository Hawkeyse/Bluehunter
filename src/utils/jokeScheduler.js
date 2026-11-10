const GroupSettings = require('../models/GroupSettings');
const { getJoke } = require('./jokesApi');
const { correctedNow } = require('./serverClock');
const { JOKE_DEFAULT_TIME_UTC, JOKE_CHECK_INTERVAL_MS } = require('../config');
const logger = require('./logger');

/** "HH:mm" -> minutes since midnight, or null if malformed. */
function parseTimeToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function todayUtcDateKey(now) {
  return now.toISOString().slice(0, 10);
}

function buildJokeMessage(type, joke) {
  const label = type === 'mom' ? "😂 *Mom Joke of the Day*" : "😂 *Dad Joke of the Day*";
  return `${label}\n\n${joke}`;
}

function startJokeScheduler(sock) {
  // Same overlap guard as autoGreetingScheduler.js - see the comment there.
  let tickInProgress = false;

  setInterval(async () => {
    if (tickInProgress) {
      logger.warn('Joke scheduler: previous tick still running, skipping this interval.');
      return;
    }
    tickInProgress = true;
    try {
      const now = correctedNow();
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const dateKey = todayUtcDateKey(now);

      const groups = await GroupSettings.find({ jokesEnabled: true });
      for (const group of groups) {
        try {
          if (group.lastJokeDate === dateKey) continue; // already posted today

          const targetMinutes = parseTimeToMinutes(group.jokesTime) ?? parseTimeToMinutes(JOKE_DEFAULT_TIME_UTC);
          if (targetMinutes !== nowMinutes) continue;

          const joke = await getJoke(group.jokesType);
          if (!joke) continue; // API hiccup - try again next tick, still same slot since date hasn't changed

          await sock.sendMessage(group.groupId, { text: buildJokeMessage(group.jokesType, joke) });

          group.lastJokeDate = dateKey;
          await group.save();
        } catch (err) {
          logger.warn('Joke scheduler failed for group', group.groupId, '-', err.message);
        }
      }
    } catch (err) {
      logger.error('Joke scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, JOKE_CHECK_INTERVAL_MS);
}

module.exports = { startJokeScheduler, buildJokeMessage };
