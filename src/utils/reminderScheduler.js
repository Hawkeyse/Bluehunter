const Reminder = require('../models/Reminder');
const logger = require('./logger');

const CHECK_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 5; // stop retrying after this many failures (e.g. permanently invalid chat)

function startReminderScheduler(sock) {
  // Same overlap guard as autoGreetingScheduler.js - see the comment there.
  // Particularly relevant here since the interval is short (15s) - a burst
  // of several due reminders sending one after another could easily run
  // past that.
  let tickInProgress = false;

  setInterval(async () => {
    if (tickInProgress) {
      logger.warn('Reminder scheduler: previous tick still running, skipping this interval.');
      return;
    }
    tickInProgress = true;
    try {
      const due = await Reminder.find({ completed: false, remindAt: { $lte: new Date() } });
      for (const r of due) {
        try {
          await sock.sendMessage(r.chatId, {
            text: `⏰ Reminder for @${r.userId.split('@')[0]}: ${r.message}`,
            mentions: [r.userId],
          });
          r.completed = true; // only mark done on a SUCCESSFUL send
          await r.save();
        } catch (err) {
          r.attempts += 1;
          logger.error(`Failed to send reminder (attempt ${r.attempts}/${MAX_ATTEMPTS}):`, err.message);
          if (r.attempts >= MAX_ATTEMPTS) {
            r.completed = true; // give up after repeated failures, don't retry forever
            logger.error('Giving up on reminder after max attempts:', r._id.toString());
          }
          await r.save();
          // left as completed: false (unless max attempts hit) - next tick retries automatically
        }
      }
    } catch (err) {
      logger.error('Reminder scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { startReminderScheduler };