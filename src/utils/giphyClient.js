const { fetchWithTimeout } = require('./http');
const { GIPHY_API_KEY } = require('../config');
const logger = require('./logger');

// WhatsApp's "GIF" is actually a looping, muted MP4 sent as a video message
// with gifPlayback: true - a raw .gif file doesn't play there at all without
// converting it first. GIPHY already hosts a ready-made MP4 for every result
// (images.<rendition>.mp4), so downloading that directly avoids needing any
// local video conversion (no ffmpeg, nothing that can fail on a host with no
// shell access).
const PREFERRED_MAX_BYTES = 3_000_000; // WhatsApp's video-message limit is generous (~16MB); this just keeps sends fast

function pickMp4Url(result) {
  const images = result?.images || {};
  // fixed_height is usually the smallest real option; downsized/original as fallbacks.
  return images.fixed_height?.mp4 || images.downsized?.mp4 || images.original?.mp4 || null;
}

function mp4Bytes(result) {
  const images = result?.images || {};
  const size = Number(images.fixed_height?.mp4_size || images.downsized?.mp4_size || images.original?.mp4_size);
  return Number.isFinite(size) ? size : Infinity;
}

/**
 * Searches GIPHY for a gif matching `query` and returns its MP4 bytes (ready
 * to send as a WhatsApp gifPlayback video message), or null on any failure
 * (no key set, no results, network error, no mp4 rendition available) -
 * fails soft: a missing gif should never break the actual text reply.
 *
 * Picks a random result from the top 10 (so /hug isn't the same gif every
 * time), preferring reasonably small renditions.
 */
async function searchGif(query) {
  if (!GIPHY_API_KEY || !query) return null;

  try {
    const searchUrl =
      `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}` +
      `&q=${encodeURIComponent(query)}&limit=10&rating=pg-13&lang=en`;

    const res = await fetchWithTimeout(searchUrl);
    if (!res.ok) {
      logger.warn('GIPHY search API error:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const results = (data.data || []).filter((r) => pickMp4Url(r));
    if (!results.length) return null;

    const small = results.filter((r) => mp4Bytes(r) <= PREFERRED_MAX_BYTES);
    const pool = small.length ? small : results;
    const result = pool[Math.floor(Math.random() * pool.length)];

    const mp4Res = await fetchWithTimeout(pickMp4Url(result));
    if (!mp4Res.ok) return null;
    return Buffer.from(await mp4Res.arrayBuffer());
  } catch (err) {
    logger.warn('GIPHY GIF search failed:', err.message);
    return null;
  }
}

module.exports = { searchGif };
