const { proto } = require('@whiskeysockets/baileys');
const { DELETED_MESSAGE_LOG_TTL_MS, DELETED_MESSAGE_LOG_PAGE_SIZE } = require('../config');
const logger = require('./logger');

const trackedMessages = new Map(); // messageId -> { groupId, userId, text, mediaType, mediaBuffer, mediaMimeType, timestamp }
const logsByGroup = new Map(); // groupId -> [{ ... }]

function normalizeMessageId(id) {
  return typeof id === 'string' && id ? id : null;
}

// Baileys can hand back the timestamp as a number OR a protobuf Long object
// (or nothing). `new Date(<Long> * 1000)` is an Invalid Date, and an invalid
// date made every log fail the age check below and get pruned instantly.
function toDate(value) {
  let ms = null;
  if (value && typeof value.toNumber === 'function') ms = value.toNumber() * 1000;
  else if (typeof value === 'number' && Number.isFinite(value)) ms = value < 1e12 ? value * 1000 : value;
  else if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  else if (typeof value === 'string' && value && !Number.isNaN(Date.parse(value))) return new Date(value);
  return ms !== null && Number.isFinite(ms) ? new Date(ms) : new Date();
}

// "233501234567:12@s.whatsapp.net" / "1234@lid" -> "233501234567" / "1234".
// WhatsApp identifies the same person as a phone jid OR a LID depending on
// the message, so matching is done on these bare ids, across every form we saw.
function bareId(jid) {
  if (!jid) return '';
  return String(jid).split('@')[0].split(':')[0].trim();
}

function collectUserIds(waMessage) {
  const key = waMessage?.key || {};
  const raw = [
    key.participant,
    key.participantPn,
    key.participantLid,
    key.senderPn,
    waMessage?.participant,
    waMessage?.sender,
    waMessage?.author,
    key.remoteJid && !String(key.remoteJid).endsWith('@g.us') ? key.remoteJid : null,
  ];
  return [...new Set(raw.map(bareId).filter(Boolean))];
}

function entryMatchesUser(entry, userId) {
  if (!userId) return true;
  const target = bareId(userId);
  if (!target) return false;
  if (bareId(entry.userId) === target) return true;
  return Array.isArray(entry.userIds) && entry.userIds.includes(target);
}

function pruneExpiredLogs(now = Date.now()) {
  const ttlMs = Number.isFinite(DELETED_MESSAGE_LOG_TTL_MS) && DELETED_MESSAGE_LOG_TTL_MS > 0 ? DELETED_MESSAGE_LOG_TTL_MS : 6 * 60 * 60 * 1000;

  // Logs expire ttlMs after they were deleted. (They used to expire ttlMs after
  // the message was SENT, so deleting anything older than the TTL logged it and
  // threw it away in the same call.)
  for (const [groupId, logs] of logsByGroup.entries()) {
    const filtered = logs.filter((entry) => now - (entry.deletedAt || entry.createdAt || now) <= ttlMs);
    if (filtered.length === 0) {
      logsByGroup.delete(groupId);
    } else {
      logsByGroup.set(groupId, filtered);
    }
  }

  // Tracked (not-yet-deleted) messages are kept for ttlMs after we saw them.
  for (const [messageId, entry] of trackedMessages.entries()) {
    if (now - (entry.createdAt || now) > ttlMs) {
      trackedMessages.delete(messageId);
    }
  }
}

function ensureGroupLogs(groupId) {
  if (!logsByGroup.has(groupId)) logsByGroup.set(groupId, []);
  return logsByGroup.get(groupId);
}

function getUserIdFromMessage(waMessage) {
  const candidates = [
    waMessage?.key?.participant,
    waMessage?.participant,
    waMessage?.sender,
    waMessage?.author,
    waMessage?.key?.remoteJid,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = String(candidate).trim();
    if (!value) continue;
    if (value.endsWith('@g.us') || value.endsWith('@broadcast')) continue;
    if (value.includes('@')) return value;
    if (/^\d{8,}$/.test(value)) return `${value}@s.whatsapp.net`;
  }

  return null;
}

// Disappearing-message groups wrap everything in ephemeralMessage (and captioned
// documents in documentWithCaptionMessage), so read the inner message. View-once
// is left alone on purpose - that has its own dedicated feature.
function innerMessage(waMessage) {
  const raw = waMessage && waMessage.message ? waMessage.message : {};
  try {
    const { unwrapMessage } = require('./mediaContent');
    const { inner, isViewOnce } = unwrapMessage(raw);
    return !isViewOnce && inner ? inner : raw;
  } catch {
    return raw;
  }
}

function extractTextFromMessage(waMessage) {
  const msg = innerMessage(waMessage);
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage && msg.extendedTextMessage.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage && msg.imageMessage.caption) return msg.imageMessage.caption;
  if (msg.videoMessage && msg.videoMessage.caption) return msg.videoMessage.caption;
  if (msg.documentMessage && msg.documentMessage.caption) return msg.documentMessage.caption;
  if (msg.stickerMessage && msg.stickerMessage.caption) return msg.stickerMessage.caption;
  if (msg.audioMessage && msg.audioMessage.caption) return msg.audioMessage.caption;
  if (msg.gifMessage && msg.gifMessage.caption) return msg.gifMessage.caption;
  return '';
}

function detectMediaType(waMessage) {
  const msg = innerMessage(waMessage);
  if (msg.imageMessage) return 'image';
  if (msg.stickerMessage) return 'sticker';
  if (msg.gifMessage || (msg.videoMessage && msg.videoMessage.gifPlayback)) return 'gif';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.documentMessage) return 'document';
  return null;
}

async function trackIncomingMessage(waMessage) {
  if (!waMessage || !waMessage.key || !waMessage.key.id) return null;
  const messageId = normalizeMessageId(waMessage.key.id);
  const groupId = waMessage.key.remoteJid;
  const userId = getUserIdFromMessage(waMessage);
  if (!messageId || !groupId || !userId || groupId === 'status@broadcast' || waMessage.key.fromMe) return null;

  const text = extractTextFromMessage(waMessage);
  const mediaType = detectMediaType(waMessage);
  const entry = {
    groupId,
    userId,
    messageId,
    text: text || '',
    mediaType,
    mediaBuffer: null,
    mediaMimeType: null,
    timestamp: toDate(waMessage.messageTimestamp),
    deletedBy: userId,
    userIds: collectUserIds(waMessage),
    key: {
      remoteJid: waMessage.key.remoteJid,
      id: waMessage.key.id,
      participant: waMessage.key.participant,
      fromMe: !!waMessage.key.fromMe,
    },
    createdAt: Date.now(),
  };

  trackedMessages.set(messageId, entry);
  if (trackedMessages.size > 5000) {
    const oldestKey = trackedMessages.keys().next().value;
    trackedMessages.delete(oldestKey);
  }

  if (mediaType) {
    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      entry.mediaBuffer = await downloadMediaMessage(waMessage, 'buffer', {});
      const msg = innerMessage(waMessage);
      const candidate = msg.imageMessage || msg.videoMessage || msg.audioMessage || msg.documentMessage || msg.stickerMessage || msg.gifMessage;
      entry.mediaMimeType = candidate && candidate.mimetype ? candidate.mimetype : null;
    } catch (err) {
      // fail-open: a deleted media log should not crash the bot or block message processing.
    }
  }

  return entry;
}

function recordDeletedMessage({ groupId, userId, messageId, text = '', mediaType = null, mediaBuffer = null, mediaMimeType = null, timestamp = new Date(), deletedBy = userId, userIds = null }) {
  if (!groupId || !userId || !messageId) return null;
  const entry = {
    groupId,
    userId,
    messageId,
    text: text || '',
    mediaType,
    mediaBuffer,
    mediaMimeType,
    timestamp: toDate(timestamp),
    deletedBy: deletedBy || userId,
    userIds: Array.isArray(userIds) && userIds.length ? userIds : [bareId(userId)].filter(Boolean),
    deletedAt: Date.now(),
    createdAt: Date.now(),
  };

  const logs = ensureGroupLogs(groupId);
  const existingIndex = logs.findIndex((item) => item.messageId === messageId && item.userId === userId);
  if (existingIndex >= 0) {
    logs[existingIndex] = entry;
  } else {
    logs.push(entry);
  }

  trackedMessages.delete(messageId);
  logs.sort((a, b) => new Date(b.deletedAt || b.timestamp).getTime() - new Date(a.deletedAt || a.timestamp).getTime());
  pruneExpiredLogs();
  trackedMessages.delete(messageId);
  return entry;
}

function getDeleteIds(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.flatMap((item) => getDeleteIds(item));
  if (typeof payload === 'string') return [payload];
  if (typeof payload === 'number') return [String(payload)];

  if (payload.ids && Array.isArray(payload.ids)) return payload.ids.flatMap((item) => getDeleteIds(item));
  if (payload.keys && Array.isArray(payload.keys)) return payload.keys.flatMap((item) => getDeleteIds(item));
  if (payload.messageKeys && Array.isArray(payload.messageKeys)) return payload.messageKeys.flatMap((item) => getDeleteIds(item));
  if (payload.messages && Array.isArray(payload.messages)) return payload.messages.flatMap((item) => getDeleteIds(item));
  if (payload.deleted && Array.isArray(payload.deleted)) return payload.deleted.flatMap((item) => getDeleteIds(item));

  const directKeyId = payload?.key?.id || payload?.key?.messageId || payload?.messageId;
  if (directKeyId) return [directKeyId];
  if (payload.id) return [payload.id];
  if (payload.key && typeof payload.key === 'string') return [payload.key];
  return [];
}

function handleDeleteEvent(payload, { deletedBy = null } = {}) {
  const seen = new Set();
  const ids = getDeleteIds(payload);
  let recorded = 0;
  for (const messageId of ids) {
    const id = normalizeMessageId(messageId);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const original = trackedMessages.get(id);
    if (!original) {
      logger.info(`deleted-log: message ${id} was deleted but the bot never saw it (sent before it started, or older than the log window)`);
      continue;
    }

    recordDeletedMessage({
      groupId: original.groupId,
      userId: original.userId,
      messageId: id,
      text: original.text,
      mediaType: original.mediaType,
      mediaBuffer: original.mediaBuffer,
      mediaMimeType: original.mediaMimeType,
      timestamp: original.timestamp,
      deletedBy: deletedBy || original.deletedBy,
      userIds: original.userIds,
    });
    recorded++;
  }
  return recorded;
}

// A user "deleting for everyone" is NOT reported through 'messages.delete' in
// Baileys (that event only fires for delete-for-me / cleared chats). It arrives
// as a 'messages.update' whose update carries messageStubType REVOKE, with
// key.id = the deleted message and key.participant = whoever deleted it.
const REVOKE_STUB_TYPE = proto?.WebMessageInfo?.StubType?.REVOKE ?? 1;

function isRevokeUpdate(entry) {
  const stub = entry?.update?.messageStubType;
  return stub === REVOKE_STUB_TYPE || stub === 'REVOKE';
}

function handleMessageUpdates(updates) {
  let recorded = 0;
  for (const entry of Array.isArray(updates) ? updates : []) {
    if (!isRevokeUpdate(entry)) continue;
    const id = entry?.key?.id;
    if (!id) continue;
    const deleter = entry.update?.key?.participant || entry.key?.participant || null;
    recorded += handleDeleteEvent([{ key: { id } }], { deletedBy: deleter });
  }
  return recorded;
}

function listDeletedLogs(groupId, userId = null, page = 1, pageSize = DELETED_MESSAGE_LOG_PAGE_SIZE || 5) {
  const logs = (logsByGroup.get(groupId) || []).filter((entry) => entryMatchesUser(entry, userId)).sort((a, b) => new Date(b.deletedAt || b.timestamp).getTime() - new Date(a.deletedAt || a.timestamp).getTime());
  const normalizedPage = Number.isFinite(page) && page > 0 ? page : 1;
  const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 5;
  const start = (normalizedPage - 1) * normalizedPageSize;
  return logs.slice(start, start + normalizedPageSize);
}

function getDeletedLogCount(groupId, userId = null) {
  const logs = (logsByGroup.get(groupId) || []).filter((entry) => entryMatchesUser(entry, userId));
  return logs.length;
}

function getTrackedMessage(groupId, messageId) {
  const entry = trackedMessages.get(messageId);
  return entry && entry.groupId === groupId ? entry : null;
}

function getRecentMessages(groupId, userId, limit) {
  const now = Date.now();
  const ttlMs = Number.isFinite(DELETED_MESSAGE_LOG_TTL_MS) && DELETED_MESSAGE_LOG_TTL_MS > 0
    ? DELETED_MESSAGE_LOG_TTL_MS
    : 6 * 60 * 60 * 1000;
  return [...trackedMessages.values()]
    .filter((entry) => entry.groupId === groupId && entry.key && entry.key.id && entry.key.remoteJid === groupId &&
      now - (entry.createdAt || now) <= ttlMs && entryMatchesUser(entry, userId))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

function startDeletedLogPruner(intervalMs = 60_000) {
  if (typeof global !== 'undefined' && global.__bluehunter_deletedLogPruner) return global.__bluehunter_deletedLogPruner;
  const timer = setInterval(() => {
    pruneExpiredLogs();
  }, intervalMs);
  timer.unref?.();
  if (typeof global !== 'undefined') global.__bluehunter_deletedLogPruner = timer;
  return timer;
}

module.exports = {
  trackIncomingMessage,
  recordDeletedMessage,
  handleDeleteEvent,
  handleMessageUpdates,
  listDeletedLogs,
  getDeletedLogCount,
  getTrackedMessage,
  getRecentMessages,
  pruneExpiredLogs,
  startDeletedLogPruner,
  logsByGroup,
  trackedMessages,
};
