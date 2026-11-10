const YoutubeWatch = require('../models/YoutubeWatch');
const { fetchLatestVideos } = require('./youtubeRss');
const { YOUTUBE_ALERT_CHECK_INTERVAL_MS } = require('../config');
const logger = require('./logger');

function buildAlertMessage(watch, video) {
  const kind = video.isShort ? '🩳 New Short!' : '🔔 New Video!';
  return `${kind}\n🎥 ${video.title}\n📺 ${watch.channelTitle || watch.channelId}\n🔗 ${video.url}`;
}

function startYoutubeAlertScheduler(sock) {
  // Same overlap guard as the other schedulers - see autoGreetingScheduler.js.
  // Matters even more here: this one does a real HTTP fetch per watched
  // channel, so a slow tick overlapping the next is more likely than the
  // purely DB-driven schedulers.
  let tickInProgress = false;

  setInterval(async () => {
    if (tickInProgress) {
      logger.warn('YouTube alert scheduler: previous tick still running, skipping this interval.');
      return;
    }
    tickInProgress = true;
    try {
      const watches = await YoutubeWatch.find({});
      for (const watch of watches) {
        try {
          const videos = await fetchLatestVideos(watch.channelId);
          if (!videos || !videos.length) continue; // feed hiccup or empty channel - try again next tick

          const latest = videos[0]; // RSS feed is already newest-first

          if (!watch.lastVideoId) {
            // First check for a newly-added channel: just record the
            // current newest video as the baseline, don't alert for it -
            // it could be weeks old, that's not a "new upload".
            watch.lastVideoId = latest.videoId;
            await watch.save();
            continue;
          }

          if (latest.videoId === watch.lastVideoId) continue; // nothing new

          // Post EVERY video newer than lastVideoId, oldest-first, in case
          // more than one upload happened since the last check (a channel
          // posting several videos/shorts within one interval isn't rare).
          const alreadySeenIndex = videos.findIndex((v) => v.videoId === watch.lastVideoId);
          const newVideos = alreadySeenIndex === -1 ? [latest] : videos.slice(0, alreadySeenIndex).reverse();

          for (const video of newVideos) {
            await sock.sendMessage(watch.groupId, { text: buildAlertMessage(watch, video) });
          }

          watch.lastVideoId = latest.videoId;
          await watch.save();
        } catch (err) {
          logger.warn('YouTube alert check failed for', watch.channelId, 'in', watch.groupId, '-', err.message);
        }
      }
    } catch (err) {
      logger.error('YouTube alert scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, YOUTUBE_ALERT_CHECK_INTERVAL_MS);
}

module.exports = { startYoutubeAlertScheduler };
