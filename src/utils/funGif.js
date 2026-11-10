const { searchGif } = require('./giphyClient');
const logger = require('./logger');

/**
 * Finds the first working GIPHY reaction (as MP4 bytes ready for a
 * gifPlayback video message) for the given search queries, trying each in
 * order until one succeeds. Returns null if all of them fail - callers
 * should fall back to a text-only reply in that case, never leave the
 * command silent. Failures are logged so you can see WHY in the console.
 */
async function fetchFunnyGif(queries) {
  for (const query of queries) {
    try {
      const mp4 = await searchGif(query);
      if (mp4) return mp4;
      logger.warn(`funGif: no gif returned for "${query}" (check GIPHY_API_KEY / network)`);
    } catch (err) {
      logger.warn(`funGif: failed for "${query}":`, err.message);
    }
  }
  return null;
}

module.exports = { fetchFunnyGif };
