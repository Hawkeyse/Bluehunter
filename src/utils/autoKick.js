const Activity = require('../models/Activity');
const GroupMember = require('../models/GroupMember');
const { OWNER_NUMBER, OWNER_LID } = require('../config');
const { getBotJid, getBotLid } = require('./waCompat');

const normalize = (id = '') => String(id).split('@')[0].split(':')[0];
const variants = (p) => [...new Set([p.id && p.id._serialized, p.jid, p.lid].filter(Boolean).map(normalize))];

const DEFAULT_GRACE_HOURS = 24;

/**
 * Members who should be auto-kicked right now, from a chat object
 * (buildChatCompat) and the group's settings.
 *
 * A member is eligible only when ALL of these hold:
 *  - not an admin, not the bot, not the bot owner
 *  - we have a tracked join time for them (people who were already in the
 *    group before join tracking started are skipped on purpose - we can't
 *    tell how long they have really been there)
 *  - they joined more than autoKickGraceHours ago
 *  - their tracked message count is autoKickMaxMessages or fewer
 */
async function findInactive(sock, chat, settings) {
  const groupId = chat.id._serialized;
  const maxMessages = Math.max(0, Number.isFinite(settings.autoKickMaxMessages) ? settings.autoKickMaxMessages : 0);
  const graceMs = Math.max(1, settings.autoKickGraceHours || DEFAULT_GRACE_HOURS) * 3600 * 1000;
  const cutoff = Date.now() - graceMs;

  const [activity, members] = await Promise.all([
    Activity.find({ groupId }).select('userId messageCount').lean(),
    GroupMember.find({ groupId }).select('userId joinedAt').lean(),
  ]);
  const countById = new Map(activity.map((a) => [normalize(a.userId), a.messageCount || 0]));
  const joinedById = new Map(members.map((m) => [normalize(m.userId), m.joinedAt]));

  const botLid = getBotLid(sock);
  const skip = new Set(
    [normalize(getBotJid(sock)), botLid ? normalize(botLid) : null, OWNER_NUMBER ? normalize(OWNER_NUMBER) : null, OWNER_LID ? normalize(OWNER_LID) : null].filter(Boolean)
  );

  return chat.participants.filter((p) => {
    if (p.isAdmin || p.isSuperAdmin) return false;
    const ids = variants(p);
    if (ids.some((i) => skip.has(i))) return false;
    const joinedAt = ids.map((i) => joinedById.get(i)).find(Boolean);
    if (!joinedAt) return false;
    if (new Date(joinedAt).getTime() > cutoff) return false;
    const count = ids.reduce((sum, i) => sum + (countById.get(i) || 0), 0);
    return count <= maxMessages;
  });
}

module.exports = { findInactive, normalize, DEFAULT_GRACE_HOURS };
