/**
 * fetch() with a default timeout. Plain fetch() has NO timeout, so one API
 * that stops answering (Bible, jokes, GIPHY, RapidAPI...) leaves that call
 * hanging forever - and every scheduler here guards itself with a
 * "tickInProgress" flag, so a single hung request would silently stop that
 * scheduler for good until the next restart.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  if (options.signal) return fetch(url, options);
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

module.exports = { fetchWithTimeout };
