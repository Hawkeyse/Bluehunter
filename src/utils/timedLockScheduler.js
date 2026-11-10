// Re-opens groups that were closed for a set time ("BlueHunter, lock this
// group for 10 mins"). The reopen time is stored on GroupSettings.reopenAt, so
// it survives restarts. Silent on purpose: WhatsApp already shows its own
// "messages are now open" notice, no need for the bot to add another.

const GroupSettings = require('../models/GroupSettings');
const { invalidateGroupMetadata } = require('./waCompat');
const logger = require('./logger');

const CHECK_INTERVAL_MS = 20_000;
const MAX_FAILURES = 5;
const failures = new Map(); // groupId -> consecutive failures

function startTimedLockScheduler(sock) {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const due = await GroupSettings.find({ reopenAt: { $ne: null, $lte: new Date() } });
      for (const group of due) {
        try {
          await sock.groupSettingUpdate(group.groupId, 'not_announcement');
          invalidateGroupMetadata(group.groupId);
          group.isOpen = true;
          group.reopenAt = null;
          await group.save();
          failures.delete(group.groupId);
          logger.info(`Timed lock ended - reopened ${group.groupId}`);
        } catch (err) {
          const n = (failures.get(group.groupId) || 0) + 1;
          failures.set(group.groupId, n);
          logger.warn(`Timed reopen failed for ${group.groupId} (${n}/${MAX_FAILURES}): ${err.message}`);
          if (n >= MAX_FAILURES) {
            // e.g. bot lost admin or left the group - stop retrying forever
            group.reopenAt = null;
            await group.save().catch(() => {});
            failures.delete(group.groupId);
          }
        }
      }
    } catch (err) {
      logger.warn('Timed lock scheduler error:', err.message);
    } finally {
      running = false;
    }
  }, CHECK_INTERVAL_MS).unref();
}

module.exports = { startTimedLockScheduler };
