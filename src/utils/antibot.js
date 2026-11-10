const { unwrapMessage } = require('./mediaContent');

// WhatsApp has no "this account is a bot" flag, so a bot is spotted by how its
// messages are built. Real WhatsApp apps (Android/iOS/Web) always stamp
// messages with a plain hex ID in a few fixed shapes. Bots built on the common
// open-source libraries leave their own fingerprint:
//   - Baileys' default ID is "3EB0" + 36 hex characters (40 total), which no
//     official client produces (Web uses a much shorter "3EB0..." ID)
//   - older Baileys / many forks use a "BAE5" prefix
//   - bots with a custom ID prefix (e.g. "NJX-...", "SUPERBOT...") contain
//     characters that are never in a real ID
// Bots that borrow WhatsApp Web's own ID generator (whatsapp-web.js) look the
// same as a person on WhatsApp Web, so those cannot be told apart this way.
const BAILEYS_DEFAULT_RE = /^3EB0[0-9A-F]{36}$/;
const BAILEYS_OLD_RE = /^BAE5[0-9A-F]{8,}$/;
const PLAIN_HEX_RE = /^[0-9A-F]+$/;

/**
 * Returns the reason string if this message's ID looks like it came from a
 * bot, otherwise null.
 */
function botFingerprint(waMessage) {
  const id = String(waMessage?.key?.id || '').trim().toUpperCase();
  if (!id) return null;
  if (BAILEYS_DEFAULT_RE.test(id)) return 'baileys-id';
  if (BAILEYS_OLD_RE.test(id)) return 'baileys-legacy-id';
  if (!PLAIN_HEX_RE.test(id)) return 'custom-id-prefix';
  return null;
}

/**
 * Messages that are not a person typing in the chat but are still sent by real
 * accounts (reactions, protocol/system messages) are skipped - their IDs are
 * generated differently and should never count as bot activity.
 */
function isCountableMessage(waMessage) {
  const { inner } = unwrapMessage(waMessage?.message || {});
  if (!inner) return false;
  const keys = Object.keys(inner);
  return keys.some((k) => !['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo'].includes(k));
}

function isLikelyBotMessage(waMessage) {
  if (!waMessage || waMessage.key?.fromMe) return false;
  if (!isCountableMessage(waMessage)) return false;
  return botFingerprint(waMessage) !== null;
}

module.exports = { isLikelyBotMessage, botFingerprint };
