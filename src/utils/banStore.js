const Ban = require('../models/Ban');
const audit = require('./auditLog');

/**
 * WhatsApp identifies the same person as either a phone jid
 * (2335xxxx@s.whatsapp.net) or an internal @lid, depending on context - a
 * mention uses one, a quoted-reply or a rejoin notification can use the
 * other, for the SAME real person. Ban records used to be matched on the
 * raw jid string, which meant: re-banning someone via a different mention
 * form silently created a second, untracked ban; /unban could say "not
 * banned" for someone who actually was; and a banned person could rejoin
 * without being auto-kicked, simply because WhatsApp reported their jid in
 * a different form than the one that was originally banned. Every lookup
 * here goes through this normalized bare-id instead of the raw jid.
 */
function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/** The stored ban document for this person in this group, matched by
 * normalized id regardless of which jid form either side is using, or null. */
async function findBan(groupId, userId) {
  const targetNorm = normalize(userId);
  const bans = await Ban.find({ groupId });
  return bans.find((b) => normalize(b.userId) === targetNorm) || null;
}

/** Creates a new ban, or updates the existing one for this person (matched
 * by normalized id) if they were already banned under a different jid form. */
async function upsertBan(groupId, userId, reason, moderatorId) {
  const existing = await findBan(groupId, userId);
  if (existing) {
    existing.reason = reason;
    existing.moderatorId = moderatorId;
    await existing.save();
    audit.logAction('ban', groupId, userId, { actorId: moderatorId, reason });
    return existing;
  }
  const created = await Ban.create({ groupId, userId, reason, moderatorId });
  audit.logAction('ban', groupId, userId, { actorId: moderatorId, reason });
  return created;
}

/** Deletes a ban document (by its real _id, not a raw jid match). */
async function removeBan(banDoc) {
  await Ban.deleteOne({ _id: banDoc._id });
  audit.logAction('unban', banDoc.groupId, banDoc.userId);
}

/**
 * Given the jid list WhatsApp reported for a group-participants.update
 * 'add' event, returns the subset that match a stored ban - each returned
 * in ITS OWN form from `participantJids` (guaranteed to be a live,
 * resolvable identity for the current membership), not the ban record's
 * stored form, which might not be current anymore.
 */
async function findBannedAmong(groupId, participantJids) {
  const bans = await Ban.find({ groupId });
  const bannedNorms = new Set(bans.map((b) => normalize(b.userId)));
  return participantJids.filter((p) => bannedNorms.has(normalize(p)));
}

module.exports = { normalize, findBan, upsertBan, removeBan, findBannedAmong };
