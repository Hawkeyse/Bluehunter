const { rapidGet, downloadMediaBuffer } = require('./rapidapiClient');
const { RAPIDAPI_YOUTUBE_HOST } = require('../config');

// Only a single video/shorts URL - deliberately excludes @handles, /channel/,
// /c/, /playlist, and ?list= links, so a channel/playlist link never gets
// treated as "one video".
const SINGLE_VIDEO_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i;

function isSingleVideoUrl(url) {
  return SINGLE_VIDEO_RE.test(url) && !/[?&]list=/i.test(url);
}

/** Pulls the 11-char video ID out of a watch/shorts/youtu.be URL. */
function extractVideoId(url) {
  const match = /(?:watch\?v=|shorts\/|youtu\.be\/)([\w-]{11})/i.exec(url);
  return match ? match[1] : null;
}

/**
 * Fetches full video data (title, duration, direct CDN format URLs) for ONE
 * video via RapidAPI's youtube138 /video/streams endpoint. This returns an
 * Invidious-style shape (`formats` = muxed video+audio, `adaptiveFormats` =
 * separate audio-only/video-only tracks, `lengthSeconds`), which is exactly
 * what pickAudioFormat/pickMuxedVideoFormat below already expect.
 *
 * NOTE: not confirmed against a live call from this dev sandbox (RapidAPI
 * hosts aren't reachable here) - if the real response uses different field
 * names, tell me and I'll adjust.
 */
async function fetchVideoData(url) {
  if (!isSingleVideoUrl(url)) {
    throw new Error('Only single video or Shorts links are supported - no channels, playlists, or @handles.');
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Couldn't read a video ID out of that link.");
  }

  const data = await rapidGet(RAPIDAPI_YOUTUBE_HOST, '/video/streams', { id: videoId });
  if (!data || (!data.formats && !data.adaptiveFormats)) {
    throw new Error('Video not found, private, age-restricted, or unavailable.');
  }
  return data;
}

/** Best audio-only stream: prefers mp4/AAC (plays everywhere in WhatsApp) over webm/opus, then highest bitrate. */
function pickAudioFormat(item) {
  const audioFormats = (item.adaptiveFormats || []).filter((f) => f.mimeType?.startsWith('audio/'));
  if (!audioFormats.length) return null;

  return [...audioFormats].sort((a, b) => {
    const aMp4 = a.mimeType.includes('mp4') ? 1 : 0;
    const bMp4 = b.mimeType.includes('mp4') ? 1 : 0;
    if (aMp4 !== bMp4) return bMp4 - aMp4;
    return (b.bitrate || 0) - (a.bitrate || 0);
  })[0];
}

/**
 * Best MUXED (video+audio already combined, no ffmpeg merge needed) format.
 * YouTube typically only serves one such quality via `formats` (usually
 * 360p) - `adaptiveFormats` has much higher resolutions, but those are
 * video-only and would need merging with a separate audio track.
 */
function pickMuxedVideoFormat(item) {
  const muxed = item.formats || [];
  if (!muxed.length) return null;
  return [...muxed].sort((a, b) => (b.height || 0) - (a.height || 0))[0];
}

module.exports = { fetchVideoData, pickAudioFormat, pickMuxedVideoFormat, downloadMediaBuffer, isSingleVideoUrl, extractVideoId };
