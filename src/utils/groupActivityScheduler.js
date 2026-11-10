const GroupSettings = require('../models/GroupSettings');
const { INACTIVE_GROUP_DAYS, INACTIVE_GROUP_CHECK_INTERVAL_MS } = require('../config');
const logger = require('./logger');

const LEAVE_NOTICE = `📢 BlueHunter Notice
Due to prolonged inactivity, I'll be leaving this group to help conserve resources and keep my services available where they're needed most.
If you'd like to invite me back in the future, you're always welcome to do so. Thank you for having me, and I wish your community all the best! 💙`;

// Guard against a bad/missing .env value producing NaN, which would otherwise
// turn into an Invalid Date and make every query throw in a tight loop.
const SAFE_DAYS = Number.isFinite(INACTIVE_GROUP_DAYS) && INACTIVE_GROUP_DAYS > 0 ? INACTIVE_GROUP_DAYS : 30;
const SAFE_INTERVAL_MS =
  Number.isFinite(INACTIVE_GROUP_CHECK_INTERVAL_MS) && INACTIVE_GROUP_CHECK_INTERVAL_MS >= 60_000
    ? INACTIVE_GROUP_CHECK_INTERVAL_MS
    : 12 * 60 * 60 * 1000; // fall back to 12h if the configured value is missing, NaN, or unreasonably small

if (!Number.isFinite(INACTIVE_GROUP_DAYS) || INACTIVE_GROUP_DAYS <= 0) {
  logger.warn(`INACTIVE_GROUP_DAYS is invalid in .env ("${INACTIVE_GROUP_DAYS}") - falling back to ${SAFE_DAYS} days.`);
}
if (!Number.isFinite(INACTIVE_GROUP_CHECK_INTERVAL_MS) || INACTIVE_GROUP_CHECK_INTERVAL_MS < 60_000) {
  logger.warn(
    `INACTIVE_GROUP_CHECK_INTERVAL_MS is invalid or too small in .env ("${INACTIVE_GROUP_CHECK_INTERVAL_MS}") - falling back to ${SAFE_INTERVAL_MS}ms.`
  );
}

function startGroupActivityScheduler(sock) {
  // Same overlap guard as autoGreetingScheduler.js - see the comment there.
  // Especially relevant here since each stale group is paced 3s apart on
  // purpose, so a run with several stale groups can easily take minutes.
  let tickInProgress = false;

  setInterval(async () => {
    if (tickInProgress) {
      logger.warn('Group activity scheduler: previous tick still running, skipping this interval.');
      return;
    }
    tickInProgress = true;
    try {
      const cutoff = new Date(Date.now() - SAFE_DAYS * 24 * 60 * 60 * 1000);
      if (isNaN(cutoff.getTime())) {
        logger.error('Group activity scheduler: computed cutoff is an invalid date, skipping this run.');
        return;
      }

      // $type: 'date' guards against any legacy/corrupt non-date value in this
      // field from crashing the query.
      const staleGroups = await GroupSettings.find({
        lastActivityAt: { $type: 'date', $lte: cutoff },
      });

      for (const group of staleGroups) {
        try {
          await sock.sendMessage(group.groupId, { text: LEAVE_NOTICE });
        } catch (err) {
          logger.warn('Failed to send inactivity notice to', group.groupId, '-', err.message);
        }

        try {
          await sock.groupLeave(group.groupId);
          logger.info('Left inactive group:', group.groupId);
        } catch (err) {
          logger.warn('Failed to leave group', group.groupId, '-', err.message);
          continue; // don't delete settings for a group we failed to actually leave
        }

        await GroupSettings.deleteOne({ _id: group._id });

        // Pace this if several groups are stale in the same run - avoid leaving
        // a burst of groups back-to-back.
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (err) {
      logger.error('Group activity scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, SAFE_INTERVAL_MS);
}

module.exports = { startGroupActivityScheduler };