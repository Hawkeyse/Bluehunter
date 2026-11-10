const Mute = require('../models/Mute');
const audit = require('./auditLog');

/**
 * Same bug, same fix as banStore.js: WhatsApp identifies the same person as
 * either a phone jid or an @lid depending on context, so matching a mute on
 * the raw jid string missed re-mutes, /unmute, and - worst of all - the
 * actual enforcement check on every incoming message. A muted person whose
 * messages happened to arrive under a different jid form than however they
 * were muted would simply never get caught: no error, no log, their
 * messages just kept going through as if they were never muted at all.
 */
function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/** The stored mute document for this person in this group, matched by
 * normalized id regardless of which jid form either side is using, or null. */
async function findMute(groupId, userId) {
  const targetNorm = normalize(userId);
  const mutes = await Mute.find({ groupId });
  return mutes.find((m) => normalize(m.userId) === targetNorm) || null;
}

/** Creates a new mute, or updates the existing one for this person (matched
 * by normalized id) if they were already muted under a different jid form. */
async function upsertMute(groupId, userId, mutedUntil, reason, moderatorId) {
  const existing = await findMute(groupId, userId);
  if (existing) {
    existing.mutedUntil = mutedUntil;
    existing.reason = reason;
    existing.moderatorId = moderatorId;
    await existing.save();
    audit.logAction('mute', groupId, userId, { actorId: moderatorId, reason, details: { until: mutedUntil } });
    return existing;
  }
  const created = await Mute.create({ groupId, userId, mutedUntil, reason, moderatorId });
  audit.logAction('mute', groupId, userId, { actorId: moderatorId, reason, details: { until: mutedUntil } });
  return created;
}

/** Deletes a mute document (by its real _id, not a raw jid match). */
async function removeMute(muteDoc) {
  await Mute.deleteOne({ _id: muteDoc._id });
  // Run by an admin command: the actor comes from the command. No context
  // means the bot lifted it itself because the timer ran out.
  audit.logAction('unmute', muteDoc.groupId, muteDoc.userId, audit.current() ? {} : { reason: 'Mute time ran out' });
}

module.exports = { normalize, findMute, upsertMute, removeMute };
