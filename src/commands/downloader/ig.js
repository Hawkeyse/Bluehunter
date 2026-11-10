const { rapidGet, downloadMediaBuffer } = require('../../utils/rapidapiClient');
const { RAPIDAPI_INSTAGRAM_HOST, SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB } = require('../../config');
const logger = require('../../utils/logger');

const IG_URL_RE = /https?:\/\/(www\.)?instagram\.com\/\S+/i;

/**
 * NOTE ON SCHEMA: this endpoint's exact response shape hasn't been confirmed
 * against a live call yet (RapidAPI keys/hosts aren't reachable from the dev
 * sandbox this was written in). This defensively checks the field names
 * that response commonly comes back as for "convert"-style downloader APIs
 * (medias[]/media[], or a single video_url/image_url/url). If the real
 * response looks different once you test it, tell me the field names and
 * I'll tighten this up - same pattern the old /x code used for Apify.
 */
function pickMediaFromResponse(data) {
  if (!data) return [];

  const arrayCandidates = [data.medias, data.media, data.result, data.data];
  for (const arr of arrayCandidates) {
    if (Array.isArray(arr) && arr.length) {
      return arr
        .map((m) => ({
          url: m.url || m.download_url || m.video_url || m.image_url || m.link,
          type: m.type || (/\.(mp4|m3u8)(\?|$)/i.test(m.url || m.download_url || '') ? 'video' : 'image'),
        }))
        .filter((m) => m.url);
    }
  }

  const singleUrl = data.video_url || data.image_url || data.download_url || data.url || data.link;
  if (singleUrl && typeof singleUrl === 'string') {
    const isVideo = /\.(mp4|m3u8)(\?|$)/i.test(singleUrl) || data.type === 'video';
    return [{ url: singleUrl, type: isVideo ? 'video' : 'image' }];
  }

  return [];
}

module.exports = {
  name: 'ig',
  aliases: ['instagram', 'igdl'],
  category: 'downloader',
  description: '/ig <Instagram link> - download a post/reel/story (photo or video)',
  async execute({ client, chat, msg, args }) {
    const url = args[0];
    if (!url || !IG_URL_RE.test(url)) {
      return msg.reply('Usage: /ig <Instagram link>\nPaste a post, reel, or story URL right after the command.');
    }

    await msg.reply('⏳ Fetching that Instagram link...');

    let data;
    try {
      data = await rapidGet(RAPIDAPI_INSTAGRAM_HOST, '/convert', { url });
    } catch (err) {
      logger.error('ig rapidapi call failed:', err.message);
      return msg.reply('⚠️ Download service is having issues right now - try again shortly.');
    }

    const media = pickMediaFromResponse(data);
    if (!media.length) {
      return msg.reply("⚠️ Couldn't get media from that link - it might be private, deleted, or an unsupported post type.");
    }

    let sentAny = false;
    for (const item of media.slice(0, 5)) { // cap at 5 items (e.g. carousel posts) per request
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
        logger.warn('ig media download failed:', err.message); // skip this one, try the rest
      }
    }

    if (!sentAny) {
      await msg.reply('⚠️ Found media but failed to download it - the links may have expired. Try again.');
    }
  },
};
