const { rapidGet, downloadMediaBuffer } = require('../../utils/rapidapiClient');
const { isSingleVideoUrl, extractVideoId } = require('../../utils/ytDownload');
const { RAPIDAPI_YOUTUBE_MP3_HOST, YT_MAX_DURATION_MINUTES, YT_MAX_FILE_SIZE_MB } = require('../../config');
const logger = require('../../utils/logger');

// youtube-mp36's /dl endpoint is a "poll the same call" API, not a two-step
// job like mp41: status is "processing" while it converts, "ok" once `link`
// is ready, or "fail" with `msg` on error. We just call /dl?id= repeatedly
// on a short interval until it settles.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15; // ~30s ceiling before we give up

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function convertToMp3(videoId) {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const data = await rapidGet(RAPIDAPI_YOUTUBE_MP3_HOST, '/dl', { id: videoId });

    if (data?.status === 'ok' && data.link) return data;
    if (data?.status === 'fail') {
      throw new Error(data.msg || 'Conversion failed for that video.');
    }
    // status === 'processing' (or missing/unexpected) -> wait and retry
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Conversion took too long - try again in a bit.');
}

module.exports = {
  name: 'ytmp3',
  aliases: ['ytaudio', 'ytmp3s'],
  category: 'downloader',
  description: `/ytmp3 <YouTube link> - download a YouTube video as audio (single video only, max ${YT_MAX_DURATION_MINUTES} min)`,
  async execute({ client, chat, msg, args }) {
    const url = args[0];
    if (!url || !isSingleVideoUrl(url)) {
      return msg.reply(
        'Usage: /ytmp3 <YouTube link>\nPaste a single video or Shorts URL right after the command (no channels or playlists).'
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return msg.reply("⚠️ Couldn't read a video ID out of that link.");
    }

    await msg.reply('⏳ Converting to audio...');

    let data;
    try {
      data = await convertToMp3(videoId);
    } catch (err) {
      logger.warn('ytmp3 rapidapi call failed:', err.message);
      return msg.reply(`⚠️ ${err.message}`);
    }

    const durationSec = parseInt(data.duration || '0', 10);
    const maxSec = YT_MAX_DURATION_MINUTES * 60;
    if (durationSec > maxSec) {
      return msg.reply(
        `⚠️ That video is ~${Math.round(durationSec / 60)} min long. Max allowed here is ${YT_MAX_DURATION_MINUTES} min, to keep downloads quick.`
      );
    }

    const sizeMB = parseInt(data.filesize || '0', 10) / (1024 * 1024);
    if (sizeMB > YT_MAX_FILE_SIZE_MB) {
      return msg.reply(`⚠️ That audio is ~${sizeMB.toFixed(1)}MB, over the ${YT_MAX_FILE_SIZE_MB}MB limit. Try a shorter video.`);
    }

    const title = data.title || 'audio';

    try {
      const buffer = await downloadMediaBuffer(data.link);
      await client.sendMessage(
        chat.id._serialized,
        {
          audio: buffer,
          mimetype: 'audio/mpeg',
          fileName: `${title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60)}.mp3`,
          ptt: false,
        },
        { quoted: msg._raw }
      );
    } catch (err) {
      logger.error('ytmp3 download failed:', err.message);
      await msg.reply('⚠️ Download failed - the link may have expired. Try again.');
    }
  },
};
