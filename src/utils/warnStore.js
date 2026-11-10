const Warning = require('../models/Warning');
const audit = require('./auditLog');

/**
 * Same bug, same fix as banStore.js and muteStore.js: WhatsApp identifies
 * the same person as either a phone jid or an @lid depending on context, so
 * matching warnings on the raw jid string silently undercounted people's
 * strikes. Split across two jid forms, someone could rack up warnings that
 * never actually reached the auto-kick threshold; /resetwarn could clear
 * only half a person's history; /warnings and /aicases could show an
 * incomplete record. This is the single shared source every warning-related
 * feature (AI moderation's auto-kick, /warn, /resetwarn, /warnings,
 * /aicases, and the antiflood/antilink/etc. 'strike' action) now goes
 * through, so a person's warning count is always complete and consistent
 * regardless of which jid form they show up under on any given message.
 */
function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/** Records a new warning. Takes the same field shape Warning.create() always did. */
async function createWarning(fields) {
  return Warning.create(fields);
}

/** All warnings for this person in this group, matched by normalized id,
 * optionally filtered by source ('manual' | 'ai'), sorted by createdAt. */
async function findWarnings(groupId, userId, { source, sortDir = -1 } = {}) {
  const targetNorm = normalize(userId);
  const query = { groupId };
  if (source) query.source = source;
  const all = await Warning.find(query);
  const filtered = all.filter((w) => normalize(w.userId) === targetNorm);
  filtered.sort((a, b) => (sortDir === 1 ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  return filtered;
}

/** Count of this person's warnings in this group, optionally filtered by source. */
async function countWarnings(groupId, userId, { source } = {}) {
  const warnings = await findWarnings(groupId, userId, { source });
  return warnings.length;
}

/** Deletes every warning for this person in this group. Returns how many were removed. */
async function deleteWarnings(groupId, userId) {
  const warnings = await findWarnings(groupId, userId);
  if (!warnings.length) return 0;
  await Warning.deleteMany({ _id: { $in: warnings.map((w) => w._id) } });
  audit.logAction('resetwarn', groupId, userId, { details: { count: warnings.length } });
  return warnings.length;
}

module.exports = { normalize, createWarning, findWarnings, countWarnings, deleteWarnings };
