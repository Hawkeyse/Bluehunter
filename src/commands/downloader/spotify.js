const { rapidGet, downloadMediaBuffer } = require('../../utils/rapidapiClient');
const { RAPIDAPI_SPOTIFY_HOST, SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB } = require('../../config');
const logger = require('../../utils/logger');

const SPOTIFY_URL_RE = /https?:\/\/open\.spotify\.com\/track\/\S+/i;

module.exports = {
  name: 'spotify',
  aliases: ['spdl', 'spotifydl'],
  category: 'downloader',
  description: '/spotify <Spotify track link> - download a song as audio',
  async execute({ client, chat, msg, args }) {
    const url = args[0];
    if (!url || !SPOTIFY_URL_RE.test(url)) {
      return msg.reply('Usage: /spotify <Spotify track link>\nPaste a track URL from open.spotify.com/track/... right after the command.');
    }

    await msg.reply('⏳ Fetching that track...');

    let data;
    try {
      data = await rapidGet(RAPIDAPI_SPOTIFY_HOST, '/downloadSong', { songId: url });
    } catch (err) {
      logger.error('spotify rapidapi call failed:', err.message);
      return msg.reply('⚠️ Download service is having issues right now - try again shortly.');
    }

    // NOTE ON SCHEMA: not confirmed against a live call (see /ig and /x for
    // the same caveat) - most "downloadSong" style endpoints on this API
    // return the direct link under data.data.downloadLink or data.link.
    const downloadUrl = data?.data?.downloadLink || data?.downloadLink || data?.link || data?.url;
    const title = data?.data?.title || data?.title || 'track';

    if (!downloadUrl) {
      return msg.reply("⚠️ Couldn't get a download link for that track - it might be region-locked or unavailable.");
    }

    try {
      const buffer = await downloadMediaBuffer(downloadUrl);
      const sizeMB = buffer.length / (1024 * 1024);
      if (sizeMB > SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB) {
        return msg.reply(`⚠️ That file is ~${sizeMB.toFixed(1)}MB, over the ${SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB}MB limit.`);
      }

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
      logger.error('spotify download failed:', err.message);
      await msg.reply('⚠️ Download failed - the link may have expired. Try again.');
    }
  },
};
