const ReminderPost = require('../models/ReminderPost');
const { isDue, sendPost } = require('./reminderPosts');
const { correctedNow } = require('./serverClock');
const { REMINDERPOST_CHECK_INTERVAL_MS } = require('../config');
const logger = require('./logger');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startReminderPostScheduler(sock) {
  let tickInProgress = false;

  setInterval(async () => {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      const now = correctedNow();
      const dateKey = now.toISOString().slice(0, 10);
      const posts = await ReminderPost.find({ enabled: true, lastPostedDate: { $ne: dateKey } });

      for (const post of posts) {
        if (!isDue(post, now)) continue;
        try {
          // Claim today's slot first (atomic), so overlapping ticks or a
          // restart can never post the same reminder twice in one day.
          const before = await ReminderPost.findOneAndUpdate(
            { _id: post._id, lastPostedDate: { $ne: dateKey } },
            { $set: { lastPostedDate: dateKey } }
          );
          if (!before) continue;
          try {
            await sendPost(sock, post);
          } catch (err) {
            // Send failed: hand the slot back so the next tick retries (still inside the catch-up window).
            await ReminderPost.updateOne({ _id: post._id }, { $set: { lastPostedDate: before.lastPostedDate } });
            throw err;
          }
          await sleep(1500); // pace sends when several groups share the same time
        } catch (err) {
          logger.warn('Reminder post failed for', post.groupId, '-', err.message);
        }
      }
    } catch (err) {
      logger.error('Reminder post scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, REMINDERPOST_CHECK_INTERVAL_MS);
}

module.exports = { startReminderPostScheduler };
