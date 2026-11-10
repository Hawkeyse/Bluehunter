const GroupSettings = require('../models/GroupSettings');
const GroupMember = require('../models/GroupMember');
const { findBannedAmong } = require('../utils/banStore');
const BotConfig = require('../models/BotConfig');
const { getBotJid, getBotLid, getGroupMetadataCached } = require('../utils/waCompat');
const { SUPPORT_GROUP_LINK, WELCOME_BATCH_QUIET_MS } = require('../config');
const { INTRO_MESSAGE, consumeRecentlyIntroduced } = require('../utils/introMessage');
const logger = require('../utils/logger');

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/**
 * Fills in the welcome/goodbye template. `userIds` can be one person or
 * many - @user becomes "@a, @b, @c" for a group of people. (Replacements are
 * done with functions so a group name containing "$&" or similar can't be
 * misread as a special replacement pattern.)
 */
function applyPlaceholders(template, userIds, groupName) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const mentionText = ids.map((id) => `@${id.split('@')[0]}`).join(', ');
  return template.replace(/@user/g, () => mentionText).replace(/\{group\}/g, () => groupName);
}

// ---- batching ----
// When an admin approves a pile of join requests (or the bot/an admin removes
// several people), WhatsApp reports each person in its own event within a
// second or two. Answering each one separately posts a wall of near-identical
// messages. Instead, collect everyone for the same group + action until things
// go quiet for WELCOME_BATCH_QUIET_MS (or 20s at most), then send ONE message
// that mentions them all.
const BATCH_MAX_WAIT_MS = 20_000;
const MAX_MENTIONS_PER_MESSAGE = 30; // a single message tagging 100+ people is its own problem
// Falls back to 5s if config.js doesn't define WELCOME_BATCH_QUIET_MS (older config).
const QUIET_MS = Number.isFinite(WELCOME_BATCH_QUIET_MS) ? WELCOME_BATCH_QUIET_MS : 5_000;
const batches = new Map(); // `${groupId}:${action}` -> { ids: Set, firstAt, timer }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function enqueueBatch(key, userIds, flush) {
  let batch = batches.get(key);
  if (!batch) {
    batch = { ids: new Set(), firstAt: Date.now(), timer: null };
    batches.set(key, batch);
  }
  for (const id of userIds) batch.ids.add(id);

  clearTimeout(batch.timer);
  const waitMs = Math.max(0, Math.min(QUIET_MS, BATCH_MAX_WAIT_MS - (Date.now() - batch.firstAt)));
  batch.timer = setTimeout(() => {
    batches.delete(key);
    flush([...batch.ids]).catch((err) => logger.error('welcome/goodbye batch failed:', err.message));
  }, waitMs);
}

/** Sends the template once for everyone in `userIds` (split only if there are a LOT of people). */
async function sendGroupedMessage(sock, groupId, userIds, template) {
  const metadata = await getGroupMetadataCached(sock, groupId);
  for (let i = 0; i < userIds.length; i += MAX_MENTIONS_PER_MESSAGE) {
    const chunk = userIds.slice(i, i + MAX_MENTIONS_PER_MESSAGE);
    const text = applyPlaceholders(template, chunk, metadata.subject);
    await sock.sendMessage(groupId, { text, mentions: chunk });
    if (i + MAX_MENTIONS_PER_MESSAGE < userIds.length) await sleep(3000);
  }
}

/**
 * Sends the one-time join intro for `groupId` if it hasn't gone out yet
 * (tracked via the persisted GroupSettings.introduced flag, not "does a doc
 * exist" - see the comment on that field). Returns true if the group was
 * left again over a prior safety flag, so the caller knows to stop
 * processing this group any further.
 *
 * Deliberately called from TWO independent triggers (see below) instead of
 * just one: the live 'group-participants.update' notification isn't always
 * delivered the instant the bot is added/joins (e.g. if it was offline at
 * that exact moment) - 'groups.update' (driven by the server's own "your
 * group list changed, go refetch" signal, not by catching one live
 * notification stanza) acts as a reliable backstop. Both are safe to call
 * redundantly since this is a no-op once `introduced` is true.
 */
async function introduceIfNew(sock, groupId) {
  const settings = await GroupSettings.getOrCreate(groupId);
  if (settings.introduced) return false;

  if (settings.autoLeftForSafety) {
    // This group was removed for a real safety violation - don't silently
    // rejoin. Redirect to the support group and leave again.
    try {
      await sock.sendMessage(groupId, {
        text:
          `⚠️ This group was previously removed for a safety policy violation.\n` +
          `If you'd like to discuss re-adding BlueHunter, please join our support group: ${SUPPORT_GROUP_LINK}`,
      });
    } catch (err) {
      // still leave even if the notice fails to send
    }
    try {
      await sock.groupLeave(groupId);
    } catch (err) {
      logger.warn('Failed to re-leave a previously auto-left group:', err.message);
    }
    return true;
  }

  // Introducing itself is a one-time system action, not an ongoing
  // "response" - so unlike everything else in this file, it is deliberately
  // NOT gated behind `canSpeak`/private mode. A group that just added the
  // bot should always hear from it, even if the owner hasn't approved the
  // group yet for private-mode replies.
  if (!consumeRecentlyIntroduced(groupId)) {
    await sock.sendMessage(groupId, { text: INTRO_MESSAGE });
  }
  await GroupSettings.findOneAndUpdate({ groupId }, { introduced: true });
  return false;
}

module.exports = function registerGroupParticipantsEvent(sock) {
  // Backstop signal: fires whenever the server marks the account's group
  // list "dirty" (join, add, leave, etc) and Baileys refetches full
  // metadata for every group currently participated in. Cheap to check here
  // since introduceIfNew short-circuits instantly for already-introduced
  // groups - this only does real work for a genuinely new group.
  sock.ev.on('groups.update', async (updates) => {
    for (const update of updates) {
      if (!update?.id) continue;
      try {
        await introduceIfNew(sock, update.id);
      } catch (err) {
        logger.warn('groups.update intro check failed for', update.id, '-', err.message);
      }
    }
  });

  sock.ev.on('group-participants.update', async ({ id: groupId, participants, action }) => {
    try {
      const botConfig = await BotConfig.getOrCreate();
      const canSpeak = botConfig.mode !== 'private' || botConfig.approvedGroups.includes(groupId);

      if (action === 'add') {
        const botJid = normalize(getBotJid(sock));
        const botLid = getBotLid(sock);
        const botCandidates = [botJid, botLid ? normalize(botLid) : null].filter(Boolean);

        const left = await introduceIfNew(sock, groupId);
        if (left) return;

        // record join time for everyone real (not the bot) - lets /removeinactive
        // avoid penalizing people who just joined and haven't had a chance to message yet
        for (const userId of participants) {
          if (botCandidates.includes(normalize(userId))) continue;
          await GroupMember.findOneAndUpdate(
            { groupId, userId },
            { joinedAt: new Date() },
            { upsert: true }
          );
        }

        // re-kick anyone who was banned and got added back in. findBannedAmong
        // matches by normalized id, not a raw jid string - the ban may be
        // stored under a different jid form (phone jid vs @lid) than
        // WhatsApp reports here for this rejoin (messageStubParameters
        // comes straight from the server with no normalization), so an
        // exact-string match used to silently miss real rejoins.
        const bannedIds = await findBannedAmong(groupId, participants);
        if (bannedIds.length > 0) {
          try {
            await sock.groupParticipantsUpdate(groupId, bannedIds, 'remove');
          } catch (err) {
            logger.warn('Failed to auto-rekick banned user(s):', err.message);
          }
        }

        if (!canSpeak) return;

        // welcome real new members - exclude the bot itself and anyone just re-kicked as banned
        const toWelcome = participants.filter((p) => !bannedIds.includes(p) && !botCandidates.includes(normalize(p)));
        if (toWelcome.length === 0) return;

        // Settings are read when the batch is actually sent, so a /setwelcome
        // or /welcome off done a moment ago is respected.
        enqueueBatch(`${groupId}:add`, toWelcome, async (userIds) => {
          const settings = await GroupSettings.getOrCreate(groupId);
          if (!settings.welcomeEnabled) return;
          const template = settings.welcomeMessage || 'Welcome @user to {group}! 👋';
          await sendGroupedMessage(sock, groupId, userIds, template);
        });
      }

      if (action === 'remove') {
        if (!canSpeak) return;

        enqueueBatch(`${groupId}:remove`, participants, async (userIds) => {
          const settings = await GroupSettings.getOrCreate(groupId);
          if (!settings.goodbyeEnabled) return;
          const template = settings.goodbyeMessage || 'Goodbye @user, we\'ll miss you. 👋';
          await sendGroupedMessage(sock, groupId, userIds, template);
        });
      }
    } catch (err) {
      logger.error('group-participants.update handler error:', err.message);
    }
  });
};
