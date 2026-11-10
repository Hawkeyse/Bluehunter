const { rapidGet, downloadMediaBuffer } = require('../../utils/rapidapiClient');
const { RAPIDAPI_TWITTER_HOST, SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB } = require('../../config');
const logger = require('../../utils/logger');

const X_URL_RE = /https?:\/\/(www\.)?(x|twitter)\.com\/\S+/i;
const TWEET_ID_RE = /status\/(\d+)/i;

/**
 * NOTE ON ENDPOINT: T's curl example for this host (twitter-api45) hit
 * community_info.php, which fetches info about a Twitter *Community*, not
 * media from a single tweet - not a fit for what /x does (download the
 * video/image from one tweet URL). This instead calls that same host's
 * tweet.php?id=<tweet_id> endpoint, which is the one this API package
 * actually exposes for single-tweet lookups (including media_extended for
 * videos/photos). I haven't been able to confirm this against a live call
 * from this dev sandbox (RapidAPI hosts aren't reachable here), so please
 * test it and tell me the real field names if something doesn't match -
 * same as the schema note this file already had for the old Apify actor.
 */
function pickMediaFromResponse(data) {
  if (!data) return [];

  const extended = data.media_extended || data.media;
  if (Array.isArray(extended) && extended.length) {
    return extended
      .map((m) => ({
        url: m.url || m.download_url || m.video_url || m.thumbnail_url,
        type: m.type === 'video' || m.type === 'animated_gif' ? 'video' : 'image',
      }))
      .filter((m) => m.url);
  }

  const singleUrl = data.download_url || data.video_url || data.url;
  if (singleUrl && typeof singleUrl === 'string') {
    const isVideo = /\.(mp4|m3u8)(\?|$)/i.test(singleUrl) || data.type === 'video';
    return [{ url: singleUrl, type: isVideo ? 'video' : 'image' }];
  }

  return [];
}

module.exports = {
  name: 'x',
  aliases: ['twitter', 'xdl', 'tweet'],
  category: 'downloader',
  description: '/x <X/Twitter link> - download video/image/GIF from a tweet',
  async execute({ client, chat, msg, args }) {
    const url = args[0];
    const idMatch = url ? TWEET_ID_RE.exec(url) : null;
    if (!url || !X_URL_RE.test(url) || !idMatch) {
      return msg.reply('Usage: /x <X/Twitter link>\nPaste a tweet URL (x.com or twitter.com) right after the command.');
    }
    const tweetId = idMatch[1];

    await msg.reply('⏳ Fetching that post...');

    let data;
    try {
      data = await rapidGet(RAPIDAPI_TWITTER_HOST, '/tweet.php', { id: tweetId });
    } catch (err) {
      logger.error('x rapidapi call failed:', err.message);
      return msg.reply('⚠️ Download service is having issues right now - try again shortly.');
    }

    const media = pickMediaFromResponse(data);
    if (!media.length) {
      return msg.reply("⚠️ Couldn't find any downloadable media in that post.");
    }

    let sentAny = false;
    for (const item of media.slice(0, 5)) {
      try {
        const buffer = await downloadMediaBuffer(item.url);
        const sizeMB = buffer.length / (1024 * 1024);
        if (sizeMB > SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB) {
          await msg.reply(`⚠️ Skipped one file - ${sizeMB.toFixed(1)}MB is over the ${SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB}MB limit.`);
          continue;
        }

        if (item.type === 'video') {
          await client.sendMessage(chat.id._serialized, { video: buffer, mimetype: 'video/mp4' }, { quoted: msg._raw });
        } else {
          await client.sendMessage(chat.id._serialized, { image: buffer, mimetype: 'image/jpeg' }, { quoted: msg._raw });
        }
        sentAny = true;
      } catch (err) {
        logger.warn('x media download failed:', err.message);
      }
    }

    if (!sentAny) {
      await msg.reply('⚠️ Found media but failed to download it - the links may have expired. Try again.');
    }
  },
};
