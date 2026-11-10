// src/utils/serverClock.js
const { SYSTEM_CLOCK_DRIFT_HOURS } = require('../config');

/**
 * Returns "now", corrected by SYSTEM_CLOCK_DRIFT_HOURS if set. Use this
 * instead of `new Date()` anywhere a scheduler extracts an hour/minute to
 * compare against a configured local-time slot (autoGreetings, autoLock,
 * bible, joke) - NOT for things that just need "an instant" with no
 * calendar-hour math (e.g. reminderScheduler's remindAt comparison, which
 * is unaffected by this kind of drift either way).
 *
 * This is a workaround for the HOST's clock being wrong, not a timezone
 * fix - COUNTRY_OFFSETS stays geographically correct regardless of this
 * value. If a positive value overshoots (things end up firing even
 * further from correct instead of closer), the drift is actually in the
 * other direction - flip the sign in .env and restart.
 */
function correctedNow() {
  const driftHours = Number(SYSTEM_CLOCK_DRIFT_HOURS) || 0;
  if (!driftHours) return new Date();
  return new Date(Date.now() + driftHours * 60 * 60 * 1000);
}

module.exports = { correctedNow };
