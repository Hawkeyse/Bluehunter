const { fetchWithTimeout } = require('./http');
const logger = require('./logger');

// Both free, keyless public APIs - no .env entry needed for either.
async function getDadJoke() {
  try {
    const res = await fetchWithTimeout('https://icanhazdadjoke.com/', { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.joke || null;
  } catch (err) {
    logger.warn('Dad joke API failed:', err.message);
    return null;
  }
}

async function getMomJoke() {
  try {
    const res = await fetchWithTimeout('https://api.yomomma.info/');
    if (!res.ok) return null;
    const data = await res.json();
    return data.joke || null;
  } catch (err) {
    logger.warn('Mom joke API failed:', err.message);
    return null;
  }
}

async function getJoke(type) {
  return type === 'mom' ? getMomJoke() : getDadJoke();
}

module.exports = { getDadJoke, getMomJoke, getJoke };
