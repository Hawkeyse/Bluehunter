const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STATUSES_PER_GROUP = 500;
const statusesByGroup = new Map();

function isGroupStatusPost(waMessage) {
  const groupId = waMessage?.key?.remoteJid;
  if (!groupId || !groupId.endsWith('@g.us') || waMessage.key.fromMe) return false;

  let current = waMessage.message;
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

function pruneGroup(groupStatuses, now = Date.now()) {
  for (const [id, entry] of groupStatuses) {
    if (now - entry.seenAt >= STATUS_TTL_MS) groupStatuses.delete(id);
  }
}

function trackGroupStatus(waMessage) {
  if (!isGroupStatusPost(waMessage) || !waMessage.key.id) return;

  const groupId = waMessage.key.remoteJid;
  let groupStatuses = statusesByGroup.get(groupId);
  if (!groupStatuses) {
    groupStatuses = new Map();
    statusesByGroup.set(groupId, groupStatuses);
  }
  pruneGroup(groupStatuses);

  const key = {
    remoteJid: groupId,
    id: waMessage.key.id,
    participant: waMessage.key.participant,
    fromMe: false,
  };
  groupStatuses.delete(key.id);
  groupStatuses.set(key.id, {
    key,
    authorId: waMessage.key.participant || '',
    seenAt: Date.now(),
  });

  while (groupStatuses.size > MAX_STATUSES_PER_GROUP) {
    groupStatuses.delete(groupStatuses.keys().next().value);
  }
}

function getTrackedGroupStatuses(groupId) {
  const groupStatuses = statusesByGroup.get(groupId);
  if (!groupStatuses) return [];
  pruneGroup(groupStatuses);
  return [...groupStatuses.values()];
}

function forgetTrackedGroupStatus(groupId, messageId) {
  const groupStatuses = statusesByGroup.get(groupId);
  if (!groupStatuses) return;
  groupStatuses.delete(messageId);
  if (!groupStatuses.size) statusesByGroup.delete(groupId);
}

module.exports = {
  trackGroupStatus,
  getTrackedGroupStatuses,
  forgetTrackedGroupStatus,
};
