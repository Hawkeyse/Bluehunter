const logger = require('./logger');

const trackers = [
  ['cooldown', require('./cooldown')],
  ['floodTracker', require('./floodTracker')],
  ['raidTracker', require('./raidTracker')],
  ['reportCooldown', require('./reportCooldown')],
  ['conflictTracker', require('./conflictTracker')],
  ['crowdModeration', require('./crowdModeration')],
];

/**
 * Every few minutes, drop expired entries from the in-memory rate-limit maps.
 * Each one adds an entry per user/group and never removed them, so a bot that
 * runs for weeks in busy groups slowly used more and more memory.
 */
function startMemorySweeper(intervalMs = 5 * 60_000) {
  setInterval(() => {
    for (const [name, tracker] of trackers) {
      try {
        tracker.prune();
      } catch (err) {
        logger.warn(`Memory sweep failed for ${name}:`, err.message);
      }
    }
  }, intervalMs).unref();
}

module.exports = { startMemorySweeper };
