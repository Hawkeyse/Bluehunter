const XWatch = require('../models/XWatch');
const { fetchLatestTweets, isNewer, resolveVideoUrl } = require('./xTimeline');
const { X_ALERT_CHECK_INTERVAL_MS, SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB } = require('../config');
const { downloadMediaBuffer } = require('./rapidapiClient');
const logger = require('./logger');
const { sendSocialAlert } = require('./socialAlertDelivery');

function buildAlertMessage(username, name, tweet) {
  const text = tweet.text.length > 600 ? `${tweet.text.slice(0, 600)}…` : tweet.text;
  return `🐦 New post from ${name || '@' + username}\n\n${text}\n\n🔗 https://x.com/${username}/status/${tweet.id}`;
}


// Send media after the text alert; an unavailable attachment must not delay it.
async function sendTweetMedia(sock, watch, tweet, username) {
  if (tweet.hasVideo) {
    try {
      const found = tweet.videoUrl ? { url: tweet.videoUrl, isGif: false } : await resolveVideoUrl(username, tweet.id);
      if (found) {
        const maxMB = SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB || 50;
        const buffer = await downloadMediaBuffer(found.url, { maxBytes: maxMB * 1024 * 1024, timeoutMs: 90_000 });
        await sendSocialAlert(sock, watch, { video: buffer, mimetype: 'video/mp4', ...(found.isGif ? { gifPlayback: true } : {}) });
        return;
      }
    } catch (err) {
      logger.warn('X alert video failed for', tweet.id, '-', err.message);
    }
  }

  for (const url of tweet.images || []) {
    try {
      const buffer = await downloadMediaBuffer(url, { maxBytes: 15 * 1024 * 1024, timeoutMs: 30_000 });
      await sendSocialAlert(sock, watch, { image: buffer });
    } catch (err) {
      logger.warn('X alert image failed:', url, '-', err.message);
    }
  }
}

async function sendTweet(sock, watch, caption, tweet, username) {
  // Alert with the text immediately. Media lookups/downloads can take much
  // longer than the feed request and must not hold up the actual notification.
  await sendSocialAlert(sock, watch, { text: caption });
  sendTweetMedia(sock, watch, tweet, username).catch((err) => {
    logger.warn('X alert media failed for', tweet.id, '-', err.message);
  });
}

// Keep polling at least once a minute by default; X/RSS has no push API, so
// the polling interval is the main bound on how quickly posts can be noticed.
const X_ALERT_BASE_MS = Number.isFinite(X_ALERT_CHECK_INTERVAL_MS) && X_ALERT_CHECK_INTERVAL_MS > 0
  ? X_ALERT_CHECK_INTERVAL_MS
  : 30_000;
const X_ALERT_FAST_MS = Math.min(X_ALERT_BASE_MS, 30_000);
const X_ALERT_MAX_MS = Math.max(X_ALERT_FAST_MS, Math.min(X_ALERT_BASE_MS, 60_000));

function startXAlertScheduler(sock) {
  let tickInProgress = false;
  let delay = X_ALERT_FAST_MS;
  let timer = null;

  const schedule = () => {
    // A little jitter keeps every watched account from polling in one burst.
    const jitter = Math.floor(Math.random() * 5_000);
    timer = setTimeout(tick, delay + jitter);
    if (timer.unref) timer.unref();
  };

  const tick = async () => {
    if (tickInProgress) {
      logger.warn('X alert scheduler: previous tick still running, skipping.');
      return;
    }
    tickInProgress = true;
    let sentFresh = false;
    try {
      const watches = await XWatch.find({});
      // One API call per unique account, however many groups watch it.
      const byUser = new Map();
      for (const w of watches) {
        if (!byUser.has(w.username)) byUser.set(w.username, []);
        byUser.get(w.username).push(w);
      }

      // Fetch accounts concurrently so a slow feed cannot delay every other
      // watched account. A small fixed pool avoids a request burst.
      const accounts = [...byUser.entries()];
      let nextAccount = 0;
      const workers = Array.from({ length: Math.min(4, accounts.length) }, async () => {
        while (nextAccount < accounts.length) {
          const [username, group] = accounts[nextAccount++];
          try {
            const tweets = await fetchLatestTweets(username, { timeoutMs: 10_000 });
            if (!tweets.length) continue;
            const latest = tweets[0];

            for (const watch of group) {
              try {
                if (!watch.lastTweetId) {
                  watch.lastTweetId = latest.id;
                  await watch.save();
                  continue;
                }
                const fresh = tweets.filter((t) => isNewer(t.id, watch.lastTweetId)).reverse(); // oldest-first
                if (!fresh.length) continue;
                for (const t of fresh.slice(-5)) {
                  await sendTweet(sock, watch, buildAlertMessage(username, t.name || watch.displayName, t), t, username);
                }
                watch.lastTweetId = latest.id;
                await watch.save();
                sentFresh = true;
              } catch (err) {
                logger.warn('X alert send failed for', username, 'in', watch.groupId, '-', err.message);
              }
            }
          } catch (err) {
            logger.warn('X alert check failed for', username, '-', err.message);
          }
        }
      });
      await Promise.all(workers);
    } catch (err) {
      logger.error('X alert scheduler error:', err.message);
    } finally {
      tickInProgress = false;
      // Hit: check again fast in case a thread just started. Quiet: double the
      // wait up to the ceiling, so a silent account costs few API calls.
      delay = sentFresh ? X_ALERT_FAST_MS : Math.min(delay * 2, X_ALERT_MAX_MS);
      schedule();
    }
  };

  schedule();
}

module.exports = { startXAlertScheduler };
