const { RAPIDAPI_KEY, YT_MAX_FILE_SIZE_MB, SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB } = require('../config');
const { fetchWithTimeout } = require('./http');

// Hard ceiling for any single download held in memory. Commands already
// check size AFTER downloading (or trust the API's reported size), which
// doesn't stop a huge/lying file from being pulled into RAM first.
const MAX_DOWNLOAD_BYTES = Math.max(YT_MAX_FILE_SIZE_MB || 0, SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB || 0, 1) * 1024 * 1024;

function requireKey() {
  if (!RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY is not set in .env');
}

/** Generic GET against a RapidAPI host. `params` becomes the query string. */
async function rapidGet(host, path, params = {}) {
  requireKey();
  const qs = new URLSearchParams(params).toString();
  const url = `https://${host}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': host,
      'x-rapidapi-key': RAPIDAPI_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`RapidAPI ${host}${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Generic POST (JSON body) against a RapidAPI host. */
async function rapidPost(host, path, body = {}) {
  requireKey();
  const url = `https://${host}${path}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': host,
      'x-rapidapi-key': RAPIDAPI_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`RapidAPI ${host}${path} failed (${res.status}): ${errBody.slice(0, 300)}`);
  }
  return res.json();
}

/** Downloads a plain media URL (the CDN link a RapidAPI response points to) as a Buffer. */
async function downloadMediaBuffer(url, { maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = 90_000 } = {}) {
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) throw new Error(`Media download failed (${res.status})`);

  const tooLarge = () => {
    const err = new Error(`That file is over the ${Math.round(maxBytes / (1024 * 1024))}MB limit.`);
    err.code = 'TOO_LARGE';
    return err;
  };

  // Reject on the declared size before downloading anything...
  const declared = Number(res.headers.get('content-length'));
  if (declared && declared > maxBytes) throw tooLarge();

  // ...and still enforce it while streaming, in case the header was missing or wrong.
  const chunks = [];
  let received = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (received > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { rapidGet, rapidPost, downloadMediaBuffer };
