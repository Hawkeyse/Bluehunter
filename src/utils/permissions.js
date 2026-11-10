const { OWNER_NUMBER, OWNER_LID } = require('../config');
const { getBotJid, getBotLid } = require('./waCompat');
const logger = require('./logger');

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

// Best-effort phone-number resolution - kept as a fallback for edge cases
// (e.g. a group that isn't using LIDs), but NOT relied on as the primary path
// anymore. Confirmed in testing: WhatsApp now consistently represents every
// participant in a group - including the bot itself - as @lid, and a sender's
// message key.participant matches that same @lid space. So comparing raw ids
// directly (after stripping @domain/:device) works without any resolution,
// and trying to resolve @lid -> phone number first (the old approach) was
// actively breaking admin checks, since it compared a resolved phone number
// against un-resolved @lid participant entries.
async function resolveNumber(sock, id) {
  if (!id) return null;
  if (id.endsWith('@s.whatsapp.net')) return normalize(id);
  if (id.endsWith('@lid')) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(id);
      if (pn) return normalize(pn);
    } catch (err) {
      logger.warn('LID resolution failed for', id, '-', err.message);
    }
    return null;
  }
  return normalize(id);
}

/** Owner check: matches against either a real-number DM (OWNER_NUMBER) or an
 * in-group @lid message (OWNER_LID, captured via the /whoami command). */
async function isOwner(sock, senderId) {
  const senderNum = normalize(senderId);
  if (OWNER_NUMBER && senderNum === normalize(OWNER_NUMBER)) return true;
  if (OWNER_LID && senderNum === normalize(OWNER_LID)) return true;
  return false;
}

/** chat here is the waCompat chat object, which already has .participants populated */
async function isGroupAdmin(sock, chat, senderId) {
  if (!chat || !chat.isGroup) return false;
  const senderNum = normalize(senderId);

  // Direct match first - senderId and chat.participants are in the same id
  // space (both @lid, or both @s.whatsapp.net) within a given group.
  let participant = chat.participants.find((p) => normalize(p.id._serialized) === senderNum);

  // Fallback for mixed-format edge cases only.
  if (!participant) {
    const resolved = await resolveNumber(sock, senderId);
    if (resolved) {
      participant = chat.participants.find((p) => normalize(p.id._serialized) === resolved);
    }
  }

  return !!participant && (participant.isAdmin || participant.isSuperAdmin);
}

function isBotAdmin(chat, sock) {
  if (!chat || !chat.isGroup) return false;

  const candidates = [normalize(getBotJid(sock))];
  const botLid = getBotLid(sock);
  if (botLid) candidates.push(normalize(botLid));

  const participant = chat.participants.find((p) => candidates.includes(normalize(p.id._serialized)));
  return !!participant && (participant.isAdmin || participant.isSuperAdmin);
}

/**
 * Returns 'bot' or 'owner' if `targetId` is someone moderation commands must
 * never be pointed at (an admin typing /kick @bot would otherwise make the
 * bot remove ITSELF from the group), or null if the target is fine.
 */
async function protectedTargetKind(sock, targetId) {
  const target = normalize(targetId);
  const botIds = [normalize(getBotJid(sock))];
  const botLid = getBotLid(sock);
  if (botLid) botIds.push(normalize(botLid));
  if (botIds.includes(target)) return 'bot';
  if (await isOwner(sock, targetId)) return 'owner';
  return null;
}

module.exports = { isOwner, isGroupAdmin, isBotAdmin, resolveNumber, protectedTargetKind };
