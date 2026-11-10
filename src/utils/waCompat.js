const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ---- in-memory group metadata cache ----
//
// Two jobs:
//  1. Our own reads (buildChatCompat, schedulers) - fresh for METADATA_TTL_MS.
//  2. Baileys' `cachedGroupMetadata` socket option (see bot.js). WITHOUT that
//     option Baileys silently calls sock.groupMetadata() - a live network
//     query to WhatsApp - before EVERY message it sends to a group. When many
//     groups use the bot at the same moment that is a burst of metadata
//     queries on top of ours, which is what trips WhatsApp's rate limit
//     ("rate-overlimit") and gets the connection dropped or the bot flagged.
//
// bot.js invalidates an entry whenever WhatsApp reports that group changed
// (members/admins/settings), so a longer TTL doesn't mean stale admin lists.
const METADATA_TTL_MS = 120_000; // how long our own reads trust an entry
const METADATA_STALE_OK_MS = 15 * 60_000; // how long an entry may still be served if a refresh fails
const metadataCache = new Map(); // jid -> { data, participants, fetchedAt }
const metadataInflight = new Map(); // jid -> Promise<entry> - one live fetch per group at a time

function mapParticipants(participants) {
  return participants.map((p) => ({
    id: { _serialized: p.id, user: p.id.split('@')[0] },
    isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
    isSuperAdmin: p.admin === 'superadmin',
    // Baileys' own groupMetadata() resolves each participant's real phone
    // number straight from WhatsApp's server response for the group (not
    // from any locally-decrypted session state), so it's available for
    // every participant immediately, even ones who've never sent a message
    // in this bot session. This used to be silently discarded here, which
    // is what forced callers (funTarget.js) onto the much weaker
    // signalRepository.lidMapping lookup, which only knows about a LID
    // once the bot has independently decrypted something from that person.
    jid: p.jid || null,
    lid: p.lid || null,
  }));
}

async function getGroupMetadataEntry(sock, jid) {
  const cached = metadataCache.get(jid);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < METADATA_TTL_MS) return cached;

  // Dedupe: if 30 messages arrive from the same group while the cache is
  // cold, they all share ONE network query instead of firing 30.
  let pending = metadataInflight.get(jid);
  if (!pending) {
    pending = (async () => {
      try {
        const data = await sock.groupMetadata(jid);
        const entry = { data, participants: mapParticipants(data.participants || []), fetchedAt: Date.now() };
        metadataCache.set(jid, entry);
        return entry;
      } catch (err) {
        // A failed refresh (rate limit, brief disconnect) shouldn't drop the
        // message when we still have a recent copy - use it instead.
        if (cached && Date.now() - cached.fetchedAt < METADATA_STALE_OK_MS) {
          logger.warn(`Group metadata refresh failed for ${jid} (${err.message}) - using cached copy.`);
          return cached;
        }
        throw err;
      } finally {
        metadataInflight.delete(jid);
      }
    })();
    metadataInflight.set(jid, pending);
  }
  return pending;
}

async function getGroupMetadataCached(sock, jid) {
  return (await getGroupMetadataEntry(sock, jid)).data;
}

/** For Baileys' `cachedGroupMetadata` option: cached copy or undefined (Baileys then fetches it itself). */
async function peekGroupMetadata(jid) {
  const cached = metadataCache.get(jid);
  if (cached && Date.now() - cached.fetchedAt < METADATA_STALE_OK_MS) return cached.data;
  return undefined;
}

function invalidateGroupMetadata(jid) {
  metadataCache.delete(jid);
}

function groupMetadataCacheSize() {
  return metadataCache.size;
}

// Floor on how long the "typing..." indicator stays up, so a fast API
// response doesn't flash it for a fraction of a second - real replies of
// this length would plausibly take this long to type out.
const MIN_TYPING_MS = 7_000;
// AI chat holds "typing..." far longer than a command reply: the model is slow
// and a long answer that lands instantly reads like a script. Only AI chat
// uses this, so moderation and command replies keep the short floor.
const MIN_AI_TYPING_MS = 25_000;

/**
 * Shows the WhatsApp "typing..." indicator in `jid` for the duration of
 * `fn` (e.g. an AI API call), then clears it - makes AI chat/moderation feel
 * like something is actually "thinking" instead of an instant reply out of
 * nowhere. Presence updates are purely cosmetic, so failures here are
 * swallowed - they should never block or fail the actual work in `fn`.
 * Waits out MIN_TYPING_MS even if `fn` resolves sooner.
 */
async function withTyping(sock, jid, fn, minMs) {
  return withPresence(sock, jid, 'composing', fn, minMs);
}

/**
 * Shows a chat presence while `fn` runs, then clears it: 'composing' for a
 * text reply, 'recording' for a voice note. Presence is cosmetic and failures
 * here are swallowed - a presence update must never break the actual reply.
 * Waits out MIN_TYPING_MS even if `fn` resolves sooner, so a fast reply still
 * reads like someone was there for a moment.
 */
async function withPresence(sock, jid, presence, fn, minMs = MIN_TYPING_MS) {
  try {
    await sock.sendPresenceUpdate(presence, jid);
  } catch (err) {
    // non-fatal
  }
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - startedAt;
    const floor = minMs || MIN_TYPING_MS;
    if (elapsed < floor) {
      await new Promise((resolve) => setTimeout(resolve, floor - elapsed));
    }
    try {
      await sock.sendPresenceUpdate('paused', jid);
    } catch (err) {
      // non-fatal
    }
  }
}

/** Pulls the actual text out of any Baileys message type we care about. */
function extractText(waMessage) {
  const m = waMessage.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

/** Baileys' own jid (sock.user.id) includes a ":deviceId" suffix - strip it. */
function getBotJid(sock) {
  const raw = sock.user?.id || '';
  return raw.split(':')[0].split('@')[0] + '@s.whatsapp.net';
}

/**
 * The bot's own @lid identity, if WhatsApp has assigned one. This is populated
 * locally by Baileys itself (no network call) once it's known - unlike other
 * users' LIDs, we don't need to resolve this, it's ours.
 */
function getBotLid(sock) {
  return sock.authState?.creds?.me?.lid || null;
}

/**
 * Builds a whatsapp-web.js-style "chat" object backed by a Baileys socket.
 * Only implements the methods your existing command files actually call.
 */
async function buildChatCompat(sock, jid) {
  const isGroup = jid.endsWith('@g.us');
  let metadata = null;
  let participants = [];
  if (isGroup) {
    const entry = await getGroupMetadataEntry(sock, jid);
    metadata = entry.data;
    participants = entry.participants; // mapped once per refresh, not once per message
  }

  return {
    id: { _serialized: jid },
    isGroup,
    name: metadata?.subject || '',
    description: metadata?.desc || '',
    createdAt: metadata?.creation || null,
    participants,

    async sendMessage(text, opts = {}) {
      return sock.sendMessage(jid, { text, mentions: opts.mentions || [] });
    },

    async removeParticipants(ids) {
      await sock.groupParticipantsUpdate(jid, ids, 'remove');
      invalidateGroupMetadata(jid);
      for (const id of ids) require('./auditLog').logAction('kick', jid, id);
    },
    async addParticipants(ids) {
      await sock.groupParticipantsUpdate(jid, ids, 'add');
      invalidateGroupMetadata(jid);
    },
    async promoteParticipants(ids) {
      await sock.groupParticipantsUpdate(jid, ids, 'promote');
      invalidateGroupMetadata(jid);
    },
    async demoteParticipants(ids) {
      await sock.groupParticipantsUpdate(jid, ids, 'demote');
      invalidateGroupMetadata(jid);
    },

    async setMessagesAdminsOnly(bool) {
      await sock.groupSettingUpdate(jid, bool ? 'announcement' : 'not_announcement');
    },
    async setInfoAdminsOnly(bool) {
      await sock.groupSettingUpdate(jid, bool ? 'locked' : 'unlocked');
    },

    // NOTE: Baileys has no exact equivalent of whatsapp-web.js's local
    // chat.clearMessages() (which wipes the linked device's local history).
    // chatModify's 'clear' action is the closest match but is version-sensitive
    // and may not be supported on every Baileys release - test this one.
    async clearMessages() {
      await sock.chatModify({ clear: { messages: [] } }, jid);
    },

    async getGroupMembershipRequests() {
      const requests = await sock.groupRequestParticipantsList(jid);
      return requests.map((r) => ({ id: { _serialized: r.jid, user: r.jid.split('@')[0] } }));
    },
    async approveGroupMembershipRequests(ids) {
      await sock.groupRequestParticipantsUpdate(jid, ids, 'approve');
    },
    async rejectGroupMembershipRequests(ids) {
      await sock.groupRequestParticipantsUpdate(jid, ids, 'reject');
    },
  };
}

/** Simple stand-in for whatsapp-web.js's MessageMedia, used by backup.js. */
const MessageMedia = {
  fromFilePath(filePath) {
    return {
      __isMediaCompat: true,
      buffer: fs.readFileSync(filePath),
      fileName: path.basename(filePath),
      mimetype: 'application/json',
    };
  },
};

/** Phone jids of any contact cards inside a (quoted) message. */
function sharedContactJids(message) {
  try {
    const { unwrapMessage } = require('./mediaContent');
    const { inner } = unwrapMessage(message) || {};
    if (!inner) return [];
    const vcards = [];
    if (inner.contactMessage?.vcard) vcards.push(inner.contactMessage.vcard);
    for (const c of inner.contactsArrayMessage?.contacts || []) if (c?.vcard) vcards.push(c.vcard);
    return vcards
      .map((v) => {
        const m = /waid=(\d+)/.exec(v) || /TEL[^:\n]*:([+\d\s\-()]+)/.exec(v);
        const digits = m ? m[1].replace(/\D/g, '') : '';
        return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Builds a whatsapp-web.js-style "msg" object backed by a Baileys message + socket.
 */
function buildMsgCompat(sock, waMessage, chatJid) {
  const senderId = waMessage.key.participant || waMessage.key.remoteJid;

  return {
    body: extractText(waMessage),
    from: waMessage.key.remoteJid,
    author: waMessage.key.participant || undefined,
    isStatus: waMessage.key.remoteJid === 'status@broadcast',
    _raw: waMessage,

    async reply(content, _unused, opts = {}) {
      const payloadOpts = { ...(opts || {}) };
      delete payloadOpts.caption;
      // backup.js passes a MessageMedia-compat object as `content`
      if (content && content.__isMediaCompat) {
        return sock.sendMessage(
          chatJid,
          {
            document: content.buffer,
            fileName: content.fileName,
            mimetype: content.mimetype,
            caption: opts.caption,
            ...(payloadOpts.mentions ? { mentions: payloadOpts.mentions } : {}),
          },
          { quoted: waMessage }
        );
      }
      return sock.sendMessage(chatJid, { text: content, ...(payloadOpts.mentions ? { mentions: payloadOpts.mentions } : {}), ...payloadOpts }, { quoted: waMessage });
    },

    async delete(_forEveryone) {
      try {
        await sock.sendMessage(chatJid, { delete: waMessage.key });
        return true;
      } catch (err) {
        // Baileys can only delete-for-everyone messages the bot sent, or (if
        // the bot is a group admin) any message - fails silently otherwise,
        // matching the old whatsapp-web.js behavior.
        return false;
      }
    },

    async getMentions() {
      const mentioned = waMessage.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      return mentioned.map((jid) => ({ id: { _serialized: jid } }));
    },

    get hasQuotedMsg() {
      return !!waMessage.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    },

    async getQuotedMessage() {
      const ctx = waMessage.message?.extendedTextMessage?.contextInfo;
      if (!ctx?.quotedMessage) return null;
      return { author: ctx.participant, from: ctx.participant, sharedContacts: sharedContactJids(ctx.quotedMessage) };
    },
  };
}

module.exports = {
  buildChatCompat,
  buildMsgCompat,
  getGroupMetadataCached,
  peekGroupMetadata,
  invalidateGroupMetadata,
  groupMetadataCacheSize,
  withTyping,
  withPresence,
  MIN_TYPING_MS,
  MIN_AI_TYPING_MS,
  getBotJid,
  getBotLid,
  extractText,
  MessageMedia,
};
