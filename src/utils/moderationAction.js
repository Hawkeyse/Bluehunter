const { createWarning, countWarnings } = require('./warnStore');
const audit = require('./auditLog');

const AUTO_KICK_THRESHOLD = 3; // matches /warn's existing 3-strike auto-kick

/**
 * Shared escalation handler for antiflood/antispam/antilink/badwords. The
 * message sent back to the group reflects what actually happened, not just
 * a generic "not allowed" - so people can tell a first-time delete apart
 * from a strike that's about to get them kicked.
 *
 * action: 'delete' | 'warn' | 'strike' | 'kick'
 *   delete - remove the message + notify why (no DB record)
 *   warn   - same as delete, kept as a distinct level for clearer intent
 *   strike - delete + notify + records a Warning (counts toward the same
 *            3-strike system as the /warn command; states the current
 *            count and auto-kicks once it reaches AUTO_KICK_THRESHOLD)
 *   kick   - delete + notify + records a Warning + kicks immediately,
 *            regardless of strike count
 */
async function applyModerationAction({ action, chat, msg, senderId, reason, requireDelete = false }) {
  const deleted = await msg.delete(true);
  const tag = `@${senderId.split('@')[0]}`;

  if (requireDelete && deleted === false) {
    await chat.sendMessage(`⚠️ ${tag} ${reason}\nI couldn't remove that status share - I need to be a group admin.`, { mentions: [senderId] });
    return;
  }

  if (action === 'delete' || action === 'warn') {
    await chat.sendMessage(`🚫 ${tag} ${reason}`, { mentions: [senderId] });
    return;
  }

  await createWarning({ groupId: chat.id._serialized, userId: senderId, reason, moderatorId: 'system' });

  if (action === 'kick') {
    try {
      await audit.runAs({ actorId: 'system', source: 'auto', reason }, () => chat.removeParticipants([senderId]));
      await chat.sendMessage(`🚫 ${tag} ${reason}\nYou've been removed from the group for this.`, { mentions: [senderId] });
    } catch (err) {
      await chat.sendMessage(
        `⚠️ ${tag} ${reason}\nYou should've been removed for this, but I couldn't - I need to be an admin in this group to do that.`,
        { mentions: [senderId] }
      );
    }
    return;
  }

  // action === 'strike': always states the running count, auto-kicks once
  // the shared threshold is reached
  const count = await countWarnings(chat.id._serialized, senderId);
  if (count >= AUTO_KICK_THRESHOLD) {
    try {
      await audit.runAs({ actorId: 'system', source: 'auto', reason: `${reason} (strike ${count}/${AUTO_KICK_THRESHOLD}, auto-kick)` }, () => chat.removeParticipants([senderId]));
      await chat.sendMessage(
        `🚫 ${tag} ${reason}\nStrike ${count}/${AUTO_KICK_THRESHOLD} - you've been auto-kicked.`,
        { mentions: [senderId] }
      );
    } catch (err) {
      await chat.sendMessage(
        `⚠️ ${tag} ${reason}\nStrike ${count}/${AUTO_KICK_THRESHOLD} - you should've been auto-kicked, but I couldn't - I need to be an admin in this group to do that.`,
        { mentions: [senderId] }
      );
    }
  } else {
    await chat.sendMessage(`⚠️ ${tag} ${reason}\nStrike ${count}/${AUTO_KICK_THRESHOLD}.`, { mentions: [senderId] });
  }
}

module.exports = { applyModerationAction, AUTO_KICK_THRESHOLD };
