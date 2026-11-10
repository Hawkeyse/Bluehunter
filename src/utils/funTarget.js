const { resolveNumber } = require('./permissions');
const { numberToJid } = require('./mentions');
const logger = require('./logger');

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/**
 * Resolves who a fun command (/hug, /kiss, /slap, etc.) is targeting, for
 * use as a caption + a real WhatsApp mention on the reaction gif.
 *
 * WhatsApp groups now commonly represent participants as @lid (an internal
 * id) rather than their phone number. Putting a raw @lid's digits straight
 * into a caption ("@56565189087267") does not render as a proper, tappable
 * mention - it just shows as a long, meaningless plain-text number.
 *
 * Two ways to resolve a @lid target to its real phone number, tried in
 * order:
 *  1. The group's own participant list (chat.participants) - WhatsApp's
 *     group metadata response resolves every participant's real number
 *     directly, independent of anything the bot has decrypted before.
 *  2. signalRepository.lidMapping (resolveNumber) - only knows about a LID
 *     once the bot has independently decrypted something from that person.
 * If BOTH fail, WhatsApp itself is very likely not sharing that person's
 * phone number at all (a "hide my number" style privacy setting on their
 * end) - there is no third method to try, this is a real privacy boundary,
 * not a bug to keep working around. Falls back to the raw LID digits in
 * that case. Logs which path resolved it (or that neither did) so a real
 * failure is visible in the console instead of silently guessed at again.
 */
async function resolveFunTarget(client, msg, chat, args) {
  const mentioned = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const rawTargetJid = mentioned[0] || null;

  if (!rawTargetJid) {
    return { targetJid: null, targetText: args.join(' ') };
  }

  if (rawTargetJid.endsWith('@lid')) {
    const rawNorm = normalize(rawTargetJid);
    const participant = (chat?.participants || []).find(
      (p) => normalize(p.id._serialized) === rawNorm || (p.lid && normalize(p.lid) === rawNorm)
    );

    if (participant?.jid) {
      const resolvedNumber = normalize(participant.jid);
      logger.info(`funTarget: resolved ${rawTargetJid} -> ${resolvedNumber} via group participant list`);
      return { targetJid: participant.jid, targetText: `@${resolvedNumber}` };
    }

    const resolvedNumber = await resolveNumber(client, rawTargetJid);
    if (resolvedNumber) {
      logger.info(`funTarget: resolved ${rawTargetJid} -> ${resolvedNumber} via signalRepository (not in participant list with a jid)`);
      return { targetJid: numberToJid(resolvedNumber), targetText: `@${resolvedNumber}` };
    }

    logger.warn(
      `funTarget: could not resolve ${rawTargetJid} to a phone number. ` +
        `In participant list: ${participant ? 'yes, but participant.jid is empty' : 'no'}. ` +
        `This usually means WhatsApp is not sharing this person's phone number at all ` +
        `(a privacy setting on their end) - falling back to the raw id.`
    );
    return { targetJid: rawTargetJid, targetText: `@${rawTargetJid.split('@')[0]}` };
  }

  return { targetJid: rawTargetJid, targetText: `@${rawTargetJid.split('@')[0]}` };
}

module.exports = { resolveFunTarget };
