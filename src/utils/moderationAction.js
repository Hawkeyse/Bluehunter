const { createWarning, countWarnings } = require('./warnStore');
const audit = require('./auditLog');
const { rememberModerationNotice } = require('./moderationApology');

const AUTO_KICK_THRESHOLD = 3; // matches /warn's existing 3-strike auto-kick

async function sendModerationNotice(chat, senderId, text, msg) {
  await chat.sendMessage(text, { mentions: [senderId] });
  rememberModerationNotice({ groupId: chat.id._serialized, senderId, waMessage: msg?._raw });
}

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
    await sendModerationNotice(chat, senderId, `⚠️ ${tag} ${reason}\nI couldn't remove that status share - I need to be a group admin.`, msg);
    return;
  }

  if (action === 'delete' || action === 'warn') {
    await sendModerationNotice(chat, senderId, `🚫 ${tag} ${reason}`, msg);
    return;
  }

  await createWarning({ groupId: chat.id._serialized, userId: senderId, reason, moderatorId: 'system' });

  if (action === 'kick') {
    try {
      await audit.runAs({ actorId: 'system', source: 'auto', reason }, () => chat.removeParticipants([senderId]));
      await sendModerationNotice(chat, senderId, `🚫 ${tag} ${reason}\nYou've been removed from the group for this.`, msg);
    } catch (err) {
      await sendModerationNotice(chat, senderId,
        `⚠️ ${tag} ${reason}\nYou should've been removed for this, but I couldn't - I need to be an admin in this group to do that.`,
        msg
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
      await sendModerationNotice(chat, senderId,
        `🚫 ${tag} ${reason}\nStrike ${count}/${AUTO_KICK_THRESHOLD} - you've been auto-kicked.`,
        msg
      );
    } catch (err) {
      await sendModerationNotice(chat, senderId,
        `⚠️ ${tag} ${reason}\nStrike ${count}/${AUTO_KICK_THRESHOLD} - you should've been auto-kicked, but I couldn't - I need to be an admin in this group to do that.`,
        msg
      );
    }
  } else {
    await sendModerationNotice(chat, senderId, `⚠️ ${tag} ${reason}\nStrike ${count}/${AUTO_KICK_THRESHOLD}.`, msg);
  }
}

module.exports = { applyModerationAction, AUTO_KICK_THRESHOLD };
