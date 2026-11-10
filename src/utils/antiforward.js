const { unwrapMessage } = require('./mediaContent');

// contextInfo lives on the content layer itself (e.g. imageMessage.contextInfo),
// not on a shared top-level field, so every type that can carry it has to be
// checked individually - same style as extractMessageContent in mediaContent.js.
// This list was missing groupInviteMessage (WhatsApp's native "tap to join"
// invite card, a common way people push other groups - a DISTINCT message
// type from a plain chat.whatsapp.com link in text, which is all antilink.js
// scans for) and albumMessage (multi-photo album posts), so forwarding either
// one straight through wasn't being caught at all.
const CONTEXT_INFO_KEYS = [
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'contactMessage',
  'contactsArrayMessage',
  'locationMessage',
  'liveLocationMessage',
  'listMessage',
  'buttonsMessage',
  'templateMessage',
  'productMessage',
  'groupInviteMessage',
  'albumMessage',
];

/**
 * True if the message (after unwrapping ephemeral/view-once layers) is a
 * forward - WhatsApp marks these with contextInfo.isForwarded, and bumps
 * forwardingScore each time it's re-forwarded further down the chain.
 */
function isForwardedMessage(waMessage) {
  const message = waMessage?.message || waMessage;
  const { inner } = unwrapMessage(message);
  if (!inner) return false;

  // NOTE: WhatsApp's forward flag/score lives on the CONTENT type's OWN
  // contextInfo (e.g. imageMessage.contextInfo.isForwarded) - there is no
  // top-level isForwarded/forwardingScore on the message envelope or on
  // messageContextInfo (that field only carries device-list/bot metadata).
  // The loop below is the only real check; do not "shortcut" with a
  // top-level lookup, it will never be set.
  for (const key of CONTEXT_INFO_KEYS) {
    const ctx = inner[key]?.contextInfo;
    if (ctx?.isForwarded || (ctx?.forwardingScore || 0) > 0) return true;
  }
  return false;
}

module.exports = { isForwardedMessage, CONTEXT_INFO_KEYS };
