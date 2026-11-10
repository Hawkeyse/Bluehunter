const Afk = require('../models/Afk');

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

/**
 * Two jobs, run on every message:
 * 1. If the sender was AFK, clear it and announce they're back (unless this
 *    message IS them setting a fresh /afk - don't immediately un-afk that).
 * 2. If the sender mentioned or replied to someone who's currently AFK,
 *    let them know.
 */
async function handleAfk({ chat, msg, senderId }) {
  const groupId = chat.id._serialized;
  const body = (msg.body || '').trim();
  const isSettingAfk = /^\W?afk\b/i.test(body);

  if (!isSettingAfk) {
    const mine = await Afk.findOneAndDelete({ groupId, userId: senderId });
    if (mine) {
      const away = formatDuration(Date.now() - mine.since.getTime());
      await chat.sendMessage(`👋 Welcome back @${senderId.split('@')[0]}, you were away for ${away}.`, {
        mentions: [senderId],
      });
    }
  }

  const targets = new Set();
  const mentioned = await msg.getMentions();
  mentioned.forEach((m) => targets.add(m.id._serialized));
  if (msg.hasQuotedMsg) {
    const quoted = await msg.getQuotedMessage();
    if (quoted?.author) targets.add(quoted.author);
    else if (quoted?.from) targets.add(quoted.from);
  }
  targets.delete(senderId);

  for (const targetId of targets) {
    const afk = await Afk.findOne({ groupId, userId: targetId });
    if (afk) {
      const away = formatDuration(Date.now() - afk.since.getTime());
      await chat.sendMessage(
        `💤 @${targetId.split('@')[0]} is AFK (${away} ago)${afk.reason ? `: ${afk.reason}` : ''}`,
        { mentions: [targetId] }
      );
    }
  }
}

module.exports = { handleAfk, formatDuration };