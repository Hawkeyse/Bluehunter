/**
 * libsignal (the crypto layer under Baileys) writes straight to console with
 * no way to turn it off:
 *   - "Failed to decrypt message with any known session..." / "Session error:
 *     Bad MAC" every time ONE incoming message can't be decrypted. That is
 *     normal and self-healing (the sender's phone retries) - it happens right
 *     after a fresh QR pair, after a restart, or when a contact re-installs
 *     WhatsApp. It does not crash anything.
 *   - "Closing session: SessionEntry {...}" dumps, which include the session's
 *     PRIVATE ratchet keys. Those should never end up in a log file or a
 *     screenshot you send to someone.
 *
 * This swallows just those lines and counts them instead, so the health line
 * (utils/health.js) can tell you if decrypt failures are actually piling up.
 * Set SIGNAL_DEBUG=1 in .env to see the raw output again.
 */
const counters = { decryptFailures: 0, badMac: 0, sessionNoise: 0 };

const DECRYPT_PREFIXES = ['Failed to decrypt message with any known session', 'Session error'];
const NOISE_PREFIXES = [
  'Closing session',
  'Closing open session',
  'Opening session',
  'Removing old closed session',
  'Migrating session',
  'Session already closed',
  'Session already open',
];

let installed = false;

function install() {
  if (installed || process.env.SIGNAL_DEBUG === '1') return;
  installed = true;

  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const first = args[0];
      if (typeof first === 'string') {
        if (DECRYPT_PREFIXES.some((p) => first.startsWith(p))) {
          counters.decryptFailures += 1;
          if (/bad mac/i.test(first)) counters.badMac += 1;
          return;
        }
        if (NOISE_PREFIXES.some((p) => first.startsWith(p))) {
          counters.sessionNoise += 1;
          return;
        }
      }
      original(...args);
    };
  }
}

/** Returns the counts since the last call, then resets them. */
function drainCounters() {
  const snapshot = { ...counters };
  counters.decryptFailures = 0;
  counters.badMac = 0;
  counters.sessionNoise = 0;
  return snapshot;
}

module.exports = { install, drainCounters };
