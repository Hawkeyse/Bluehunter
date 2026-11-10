const { issueCode, webEnabled, webUrl } = require('../../web/server');
const { resolveNumber } = require('../../utils/permissions');
const logger = require('../../utils/logger');

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/**
 * Prefer a real phone JID for outbound DMs from a group context.
 * Group senders are often @lid; sendMessage(@lid) can resolve without error
 * while the message never appears in the user's normal 1:1 chat.
 */
async function dmTargetJid(client, chat, msg, senderId) {
  const senderKey = normalize(senderId);
  const candidates = [];

  const key = msg && msg._raw && msg._raw.key;
  if (key) {
    for (const field of ['participantPn', 'participantAlt', 'senderPn', 'remoteJidAlt']) {
      const v = key[field];
      if (v && String(v).endsWith('@s.whatsapp.net')) candidates.push(String(v));
    }
  }

  if (chat && chat.isGroup && Array.isArray(chat.participants)) {
    const part = chat.participants.find(
      (p) =>
        normalize(p.id && p.id._serialized) === senderKey ||
        normalize(p.lid) === senderKey ||
        normalize(p.jid) === senderKey
    );
    if (part && part.jid) {
      const jid = String(part.jid).includes('@')
        ? String(part.jid)
        : `${normalize(part.jid)}@s.whatsapp.net`;
      candidates.push(jid);
    }
  }

  if (senderId.endsWith('@s.whatsapp.net')) candidates.push(senderId);

  if (senderId.endsWith('@lid')) {
    const num = await resolveNumber(client, senderId);
    if (num) candidates.push(`${num}@s.whatsapp.net`);
  }

  const phone = [...new Set(candidates.filter((j) => j.endsWith('@s.whatsapp.net')))];
  const other = [...new Set(candidates.filter((j) => !j.endsWith('@s.whatsapp.net')))];
  return [...phone, ...other, senderId].filter(Boolean);
}

function buildCodeText(code, url, { publicFallback } = {}) {
  let text =
    `🔐 *BlueHunter login code*\n\nCode: *${code}*\n` +
    (url ? `Open: ${url}\n` : '') +
    `\nIt works once and expires in 10 minutes. Signing in unlocks every group where you're an admin and BlueHunter is present - not just this one. Don't share it.`;
  if (publicFallback) {
    text +=
      '\n\n⚠️ _Posted here because WhatsApp is not delivering private DMs from this bot number. Use it now and delete this message._';
  }
  return text;
}

module.exports = {
  name: 'verify',
  aliases: ['dashboard', 'panel'],
  category: 'general',
  description:
    '/verify - DM a login code for the BlueHunter site. /verify here = post it in this group instead',
  groupOnly: false,
  async execute({ client, msg, chat, args, senderId }) {
    if (!webEnabled()) return msg.reply('The web dashboard is turned off right now.');

    const forceHere =
      args &&
      args[0] &&
      ['here', 'group', 'chat', 'public'].includes(String(args[0]).toLowerCase());

    const code = issueCode(senderId);
    const url = webUrl();

    // Private chat with the bot, or explicit /verify here → always reply in place.
    if (!chat.isGroup || forceHere) {
      await msg.reply(buildCodeText(code, url, { publicFallback: !!chat.isGroup && forceHere }));
      return;
    }

    // Group default: try private DM first.
    let candidates = [];
    try {
      candidates = await dmTargetJid(client, chat, msg, senderId);
    } catch (err) {
      logger.warn(`verify: could not resolve a private-chat address for ${senderId}: ${err.message}`);
    }
    logger.info(`verify: DM candidates for ${senderId}: ${candidates.join(', ')}`);

    const dmText = buildCodeText(code, url);
    let dmAccepted = false;
    for (const jid of candidates) {
      try {
        await client.sendMessage(jid, { text: dmText });
        dmAccepted = true;
        break;
      } catch (err) {
        logger.warn(`verify DM failed to ${jid}: ${err && err.message}`);
      }
    }

    if (dmAccepted) {
      // Baileys may accept a send that WhatsApp does not ultimately deliver.
      await msg.reply(
        '📩 I attempted to DM your login code (expires in 10 minutes).\n\n' +
          'If it did **not** arrive, message me directly and send `/verify` to request a fresh code in private chat.'
      );
      return;
    }

    // Login codes are private by default. Never expose one in a group as an
    // automatic fallback; the user can explicitly opt in with `/verify here`.
    await msg.reply(
      '⚠️ I could not deliver your login code privately, so I did not post it here.\n\n' +
        'Message me directly and send `/verify` to request a code in this private chat, or use `/verify here` if you want it posted in this group.'
    );
  },
};