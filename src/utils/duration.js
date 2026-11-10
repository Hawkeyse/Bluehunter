const UNITS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parses "10m", "1h", "1d", "perm" into a Date (mutedUntil) or null (permanent).
 * Returns { ms: number|null, valid: boolean }
 */
function parseDuration(input) {
  if (!input) return { ms: null, valid: false };
  const val = input.toLowerCase().trim();

  if (val === 'perm' || val === 'permanent') return { ms: null, valid: true };

  const match = val.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return { ms: null, valid: false };

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  return { ms: amount * UNITS[unit], valid: true };
}

module.exports = { parseDuration };
