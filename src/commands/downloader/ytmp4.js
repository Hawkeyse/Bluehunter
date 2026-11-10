const { fetchVideoData, pickMuxedVideoFormat, downloadMediaBuffer, isSingleVideoUrl } = require('../../utils/ytDownload');
const { YT_MAX_DURATION_MINUTES, YT_MAX_FILE_SIZE_MB } = require('../../config');
const logger = require('../../utils/logger');

module.exports = {
  name: 'ytmp4',
  aliases: ['ytvideo'],
  category: 'downloader',
  description: `/ytmp4 <YouTube link> - download a YouTube video (single video only, max ${YT_MAX_DURATION_MINUTES} min)`,
  async execute({ client, chat, msg, args }) {
    const url = args[0];
    if (!url || !isSingleVideoUrl(url)) {
      return msg.reply(
        'Usage: /ytmp4 <YouTube link>\nPaste a single video or Shorts URL right after the command (no channels or playlists).'
      );
    }

    let item;
    try {
      item = await fetchVideoData(url);
    } catch (err) {
      logger.warn('ytmp4 fetch failed:', err.message);
      return msg.reply(`⚠️ ${err.message}`);
    }

    const durationSec = parseInt(item.lengthSeconds || '0', 10);
    const maxSec = YT_MAX_DURATION_MINUTES * 60;
    if (durationSec > maxSec) {
      return msg.reply(
        `⚠️ That video is ~${Math.round(durationSec / 60)} min long. Max allowed here is ${YT_MAX_DURATION_MINUTES} min, to keep downloads quick.`
      );
    }

    const format = pickMuxedVideoFormat(item);
    if (!format) {
      return msg.reply("⚠️ Couldn't find a usable combined video+audio track for that video.");
    }

    const sizeMB = parseInt(format.contentLength || '0', 10) / (1024 * 1024);
    if (sizeMB > YT_MAX_FILE_SIZE_MB) {
      return msg.reply(`⚠️ That video is ~${sizeMB.toFixed(1)}MB, over the ${YT_MAX_FILE_SIZE_MB}MB limit. Try a shorter video.`);
    }

    await msg.reply(`⏳ Grabbing video for *${item.title}* (${format.qualityLabel || 'best available'})...`);

    try {
      const buffer = await downloadMediaBuffer(format.url);
      await client.sendMessage(
        chat.id._serialized,
        {
          video: buffer,
          mimetype: 'video/mp4',
          fileName: `${item.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60)}.mp4`,
          caption: item.title,
        },
        { quoted: msg._raw }
      );
    } catch (err) {
      logger.error('ytmp4 download failed:', err.message);
      await msg.reply('⚠️ Download failed - the link may have expired. Try again.');
    }
  },
};
