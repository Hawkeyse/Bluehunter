const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'bluehunter.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // rotate at 5MB (keeps one previous file: bluehunter.log.1)
let writesSinceCheck = 0;

function rotateIfNeeded() {
  try {
    if (fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch (e) {
    // file doesn't exist yet, or can't be checked - nothing to rotate
  }
}

function log(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args.join(' ')}`;
  console.log(line);
  try {
    // The log used to grow without limit (one line per event, forever).
    if (writesSinceCheck++ % 200 === 0) rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {
    // don't crash the bot over log write failures
  }
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  LOG_FILE,
};
