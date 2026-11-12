const YoutubeWatch = require('../models/YoutubeWatch');
const { fetchLatestVideos } = require('./youtubeRss');
const { fetchVideoData, pickMuxedVideoFormat, downloadMediaBuffer } = require('./ytDownload');
const { createLimiter } = require('./limiter');
const { sendSocialAlert } = require('./socialAlertDelivery');
const {
  YOUTUBE_ALERT_CHECK_INTERVAL_MS,
  RAPIDAPI_KEY,
  YT_MAX_DURATION_MINUTES,
  YT_MAX_FILE_SIZE_MB,
} = require('../config');
const logger = require('./logger');

function buildAlertMessage(watch, video) {
  const kind = video.isShort ? '🩳 New Short!' : '🔔 New Video!';
  return `${kind}\n🎥 ${video.title}\n📺 ${watch.channelTitle || watch.channelId}\n🔗 ${video.url}`;
}

const videoUploadLimiter = createLimiter({
  concurrency: 2,
  taskTimeoutMs: 5 * 60_000,
  onError: (err) => logger.warn('YouTube alert video upload failed:', err.message),
});

async function attachYoutubeVideo(sock, watch, video) {
  if (!watch.includeVideo || !RAPIDAPI_KEY) return;

  const item = await fetchVideoData(video.url);
  const durationSec = Number.parseInt(item.lengthSeconds || '0', 10);
  if (durationSec > YT_MAX_DURATION_MINUTES * 60) {
    logger.info(`YouTube alert video skipped for ${video.videoId}: over ${YT_MAX_DURATION_MINUTES} minute limit.`);
    return;
  }

  const format = pickMuxedVideoFormat(item);
  if (!format || !format.mimeType?.toLowerCase().startsWith('video/mp4')) {
    logger.info(`YouTube alert video skipped for ${video.videoId}: no combined MP4 format is available.`);
    return;
  }

  const maxBytes = YT_MAX_FILE_SIZE_MB * 1024 * 1024;
  const declaredBytes = Number.parseInt(format.contentLength || '0', 10);
  if (declaredBytes > maxBytes) {
    logger.info(`YouTube alert video skipped for ${video.videoId}: over ${YT_MAX_FILE_SIZE_MB} MB limit.`);
    return;
  }

  const buffer = await downloadMediaBuffer(format.url, { maxBytes });
  const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || video.videoId;
  await sendSocialAlert(sock, watch, {
    video: buffer,
    mimetype: 'video/mp4',
    fileName: `${safeTitle}.mp4`,
    caption: `${video.title}\n${video.url}`,
  });
}

async function sendYoutubeAlert(sock, watch, video) {
  await sendSocialAlert(sock, watch, { text: buildAlertMessage(watch, video) });
  if (watch.includeVideo && RAPIDAPI_KEY) {
    if (videoUploadLimiter.stats().queued >= 20) {
      logger.warn('YouTube alert video skipped for', video.videoId, '- upload queue is full.');
      return;
    }
    videoUploadLimiter.run(() => attachYoutubeVideo(sock, watch, video));
  }
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
            await sendYoutubeAlert(sock, watch, video);
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

module.exports = { startYoutubeAlertScheduler, sendYoutubeAlert, attachYoutubeVideo };
