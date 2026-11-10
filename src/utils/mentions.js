/**
 * Resolve the target user id for commands like /mute @user, /kick @user.
 * Supports: @mention in the message, replying to (quoting) their message, or replying to a shared contact card.
 * Returns a WhatsApp jid string (xxxxx@s.whatsapp.net) or null if no target found.
 */
async function getTargetUser(msg) {
  // Set by the "BlueHunter, <do something>" layer, which has already worked
  // out who the request is about (tag, reply, shared contact or number).
  if (msg._targetOverride) return msg._targetOverride;

  const mentioned = await msg.getMentions();
  if (mentioned && mentioned.length > 0) {
    return mentioned[0].id._serialized;
  }

  if (msg.hasQuotedMsg) {
    const quoted = await msg.getQuotedMessage();
    // Replying to a shared contact card targets the person on the card.
    if (quoted && quoted.sharedContacts && quoted.sharedContacts.length > 0) return quoted.sharedContacts[0];
    if (quoted && quoted.author) return quoted.author;
    if (quoted && quoted.from) return quoted.from;
  }

  return null;
}

/** Turn a raw number typed by the owner (e.g. "233501234567") into a jid. */
function numberToJid(raw) {
  const digits = raw.toString().replace(/[^0-9]/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

module.exports = { getTargetUser, numberToJid };
