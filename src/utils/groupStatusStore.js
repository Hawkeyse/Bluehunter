const GroupStatusPost = require('../models/GroupStatusPost');

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

function containsGroupStatusMessage(message) {
  let current = message;
  let guard = 0;
  while (current && guard < 5) {
    guard++;
    if (current.groupStatusMessage) return true;

    const wrapper = current.ephemeralMessage
      || current.viewOnceMessage
      || current.viewOnceMessageV2
      || current.viewOnceMessageV2Extension
      || current.documentWithCaptionMessage
      || current.editedMessage
      || current.messageContextInfo
      || current.groupMentionedMessage;
    if (!wrapper?.message) break;
    current = wrapper.message;
  }
  return false;
}

function getMessageDate(timestamp) {
  if (!timestamp) return new Date();
  const seconds = typeof timestamp.toNumber === 'function' ? timestamp.toNumber() : Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function getAuthorId(key) {
  return key.participant
    || key.participantPn
    || key.participantLid
    || key.senderPn
    || key.senderLid
    || '';
}

async function trackGroupStatus(waMessage) {
  const key = waMessage?.key;
  const groupId = key?.remoteJid;
  if (!groupId?.endsWith('@g.us') || key.fromMe || !key.id || !containsGroupStatusMessage(waMessage.message)) return;

  const seenAt = getMessageDate(waMessage.messageTimestamp);
  const expiresAt = new Date(seenAt.getTime() + STATUS_TTL_MS);
  if (expiresAt <= new Date()) return;

  await GroupStatusPost.findOneAndUpdate(
    { groupId, messageId: key.id },
    {
      $set: {
        authorId: getAuthorId(key),
        key: { ...key },
        seenAt,
        expiresAt,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function getTrackedGroupStatuses(groupId) {
  return GroupStatusPost.find({ groupId, expiresAt: { $gt: new Date() } })
    .sort({ seenAt: 1 })
    .lean();
}

async function forgetTrackedGroupStatus(groupId, messageId) {
  return GroupStatusPost.deleteOne({ groupId, messageId });
}

module.exports = {
  trackGroupStatus,
  getTrackedGroupStatuses,
  forgetTrackedGroupStatus,
};
