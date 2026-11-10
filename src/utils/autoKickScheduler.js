const GroupSettings = require('../models/GroupSettings');
const { buildChatCompat } = require('./waCompat');
const { isBotAdmin } = require('./permissions');
const { findInactive, normalize } = require('./autoKick');
const { AUTO_KICK_CHECK_INTERVAL_MS } = require('../config');
const logger = require('./logger');

const MAX_PER_TICK = 5; // per group per check - a big backlog drains gradually instead of one mass-kick burst
const KICK_DELAY_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runForGroup(sock, settings) {
  const chat = await buildChatCompat(sock, settings.groupId);
  if (!isBotAdmin(chat, sock)) return; // can't kick without admin
  const candidates = await findInactive(sock, chat, settings);
  if (!candidates.length) return;

  const removed = [];
  for (const p of candidates.slice(0, MAX_PER_TICK)) {
    try {
      await chat.removeParticipants([p.id._serialized]);
      removed.push(p);
    } catch (err) {
      logger.warn('Auto-kick failed for', p.id._serialized, '-', err.message);
    }
    await sleep(KICK_DELAY_MS);
  }
  if (!removed.length) return;

  const max = settings.autoKickMaxMessages || 0;
  const list = removed.map((p) => `@${p.jid ? normalize(p.jid) : p.id.user}`).join(', ');
  await chat.sendMessage(
    `🧹 Removed ${removed.length} inactive member(s): ${list}\n` +
      `(${max === 0 ? 'no messages' : `${max} message(s) or fewer`} after ${settings.autoKickGraceHours || 24}h in the group)`,
    { mentions: removed.map((p) => p.jid || p.id._serialized) }
  );
}

function startAutoKickScheduler(sock) {
  let tickInProgress = false;
  setInterval(async () => {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      const groups = await GroupSettings.find({ autoKickEnabled: true });
      for (const settings of groups) {
        try {
          await runForGroup(sock, settings);
        } catch (err) {
          logger.warn('Auto-kick failed for group', settings.groupId, '-', err.message);
        }
      }
    } catch (err) {
      logger.error('Auto-kick scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, AUTO_KICK_CHECK_INTERVAL_MS);
}

module.exports = { startAutoKickScheduler, runForGroup };
