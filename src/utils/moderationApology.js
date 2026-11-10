const { normalize } = require('./warnStore');

const APOLOGY_RE = /^(?:(?:ok(?:ay)?|alright|ah|oh)\s+)?(?:i'?m\s+sorry|i am sorry|sorry|sry|my bad|apologies|i apologize|forgive me)(?:[.!?,\s].*)?$/i;
const NOTICE_TTL_MS = 5 * 60_000;
const MAX_PENDING_NOTICES = 5000;
const pendingNotices = new Map();

function getUserKeys(groupId, senderId, waMessage) {
  const key = waMessage?.key || {};
  const ids = [
    senderId,
    key.participant,
    key.participantPn,
    key.participantLid,
    key.senderPn,
    waMessage?.participant,
  ].filter(Boolean);
  return [...new Set(ids.map((id) => `${groupId}|${normalize(id)}`))];
}

function rememberModerationNotice({ groupId, senderId, waMessage }) {
  const expiresAt = Date.now() + NOTICE_TTL_MS;
  for (const key of getUserKeys(groupId, senderId, waMessage)) {
    pendingNotices.set(key, expiresAt);
  }

  if (pendingNotices.size > MAX_PENDING_NOTICES) {
    const now = Date.now();
    for (const [key, expires] of pendingNotices) {
      if (expires <= now || pendingNotices.size > MAX_PENDING_NOTICES) pendingNotices.delete(key);
    }
  }
}

async function maybeHandleModerationApology({ chat, msg, senderId }) {
  if (!chat?.isGroup) return false;
  const text = (msg?.body || '').trim();
  if (text.length > 100 || !APOLOGY_RE.test(text)) return false;

  const keys = getUserKeys(chat.id._serialized, senderId, msg?._raw);
  const now = Date.now();
  let wasRecentlyModerated = false;
  for (const key of keys) {
    const expires = pendingNotices.get(key);
    pendingNotices.delete(key);
    if (expires && expires > now) wasRecentlyModerated = true;
  }
  if (!wasRecentlyModerated) return false;

  await chat.sendMessage("It's okay — just don't do it again, please.", { mentions: [senderId] });
  return true;
}

module.exports = { rememberModerationNotice, maybeHandleModerationApology };
