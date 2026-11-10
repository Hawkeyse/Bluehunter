// "BlueHunter, <do something>" - plain-language admin commands.
//
// An admin (or the owner) writes e.g. "BlueHunter kick this person" (replying
// to them or to their shared contact), "BlueHunter approve all", "BlueHunter
// who's requesting to join", "BlueHunter lock this group for 10 mins". The AI
// only PICKS which existing command to run and its arguments; the command then
// runs through the normal command pipeline, so every permission check, cooldown
// and audit entry is the same as typing it with the prefix. The bot reacts with
// a check mark on the request, then the command does its thing.
//
// Only admins/owner can use this. Non-admins fall through to normal AI chat.

const GroupSettings = require('../models/GroupSettings');
const { getCommandIntent } = require('./openaiClient');
const { isBotAdmin } = require('./permissions');
const { getBotJid, getBotLid } = require('./waCompat');
const { unwrapMessage } = require('./mediaContent');
const cooldown = require('./cooldown');
const logger = require('./logger');

// Bulk or destructive commands are never run from a casual sentence - use the
// slash command for these on purpose.
const NL_DENY = new Set(['removeinactive', 'kickcountry', 'reset', 'deletelogs', 'clear', 'backup', 'restart']);

// Commands that act on one person. They need a resolvable target.
const TARGET_COMMANDS = new Set([
  'kick', 'remove', 'promote', 'demote', 'warn', 'mute', 'unmute', 'ban', 'unban',
  'warnings', 'resetwarn', 'aicases', 'approve', 'decline',
]);
// Commands that take a phone number as their argument.
const NUMBER_ARG_COMMANDS = new Set(['add', 'approve', 'decline']);

const MAX_TIMED_LOCK_MINUTES = 7 * 24 * 60;

const TRIGGER_RE = /^\s*(?:(?:hey|hi|hello|yo|ok|okay|pls|please)[\s,]+)?@?blue\s?hunter\b[\s,:;!.\-–—]*([\s\S]*)$/i;

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/** The request text after "BlueHunter", or null if this isn't addressed to the bot. */
function extractRequest(body = '', botMentioned = false) {
  const m = TRIGGER_RE.exec(body || '');
  if (m && m[1].trim()) return m[1].trim().replace(/^(?:please|pls|plz|abeg|kindly)[\s,]+/i, '').trim() || null;
  if (botMentioned) {
    const stripped = (body || '').replace(/@\d{5,}/g, '').replace(/\s+/g, ' ').trim();
    if (stripped) return stripped;
  }
  return null;
}

function clampMinutes(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(n, MAX_TIMED_LOCK_MINUTES);
}

function phoneFromText(text = '') {
  const m = /\+?\d[\d\s\-()]{6,}\d/.exec(text);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function vcardDigits(vcard = '') {
  const m = /waid=(\d+)/.exec(vcard) || /TEL[^:\n]*:([+\d\s\-()]+)/.exec(vcard);
  const digits = m ? m[1].replace(/\D/g, '') : '';
  return digits.length >= 8 ? digits : null;
}

function contextInfoOf(inner) {
  if (!inner) return null;
  for (const key of Object.keys(inner)) {
    if (inner[key]?.contextInfo) return inner[key].contextInfo;
  }
  return null;
}

/** Phone number of a contact card that was shared in the message being replied to. */
function quotedContactDigits(contextInfo) {
  const quoted = contextInfo?.quotedMessage;
  if (!quoted) return null;
  const { inner } = unwrapMessage(quoted) || {};
  if (!inner) return null;
  if (inner.contactMessage?.vcard) return vcardDigits(inner.contactMessage.vcard);
  const first = inner.contactsArrayMessage?.contacts?.[0];
  return first?.vcard ? vcardDigits(first.vcard) : null;
}

/** Maps a phone number onto the id WhatsApp uses for that member in this group (often an @lid). */
function toParticipantId(chat, digits) {
  const hit = (chat.participants || []).find(
    (p) => (p.jid && normalize(p.jid) === digits) || normalize(p.id._serialized) === digits
  );
  return hit ? hit.id._serialized : `${digits}@s.whatsapp.net`;
}

/**
 * Who the request is about, in priority order: someone tagged, a shared contact
 * card being replied to, the author of the message being replied to, a phone
 * number written in the request. Returns { jid, digits, source } or null.
 */
function resolveTarget({ sock, chat, waMessage, request }) {
  const { inner } = unwrapMessage(waMessage.message) || {};
  const ctx = contextInfoOf(inner);
  const botIds = new Set([normalize(getBotJid(sock))]);
  const botLid = getBotLid(sock);
  if (botLid) botIds.add(normalize(botLid));

  const mentioned = (ctx?.mentionedJid || []).find((j) => !botIds.has(normalize(j)));
  if (mentioned) return { jid: mentioned, digits: null, source: 'mention' };

  const contactDigits = quotedContactDigits(ctx);
  if (contactDigits) return { jid: toParticipantId(chat, contactDigits), digits: contactDigits, source: 'contact' };

  if (ctx?.quotedMessage && ctx.participant && !botIds.has(normalize(ctx.participant))) {
    return { jid: ctx.participant, digits: null, source: 'reply' };
  }

  const typed = phoneFromText(request);
  if (typed) return { jid: toParticipantId(chat, typed), digits: typed, source: 'number' };

  return null;
}

function botIsMentioned(sock, waMessage) {
  const { inner } = unwrapMessage(waMessage.message) || {};
  const mentioned = contextInfoOf(inner)?.mentionedJid || [];
  const ids = new Set([normalize(getBotJid(sock))]);
  const lid = getBotLid(sock);
  if (lid) ids.add(normalize(lid));
  return mentioned.some((j) => ids.has(normalize(j)));
}

function isAllowedCommand(command, senderIsOwner) {
  if (!command || !command.adminOnly) return false;
  if (command.category === 'system' || NL_DENY.has(command.name)) return false;
  if (command.ownerOnly && !senderIsOwner) return false;
  return true;
}

const catalogCache = new Map(); // `${owner}|${size}` -> text
function buildCatalog(commands, senderIsOwner) {
  const key = `${senderIsOwner ? 1 : 0}|${commands.size}`;
  if (catalogCache.has(key)) return catalogCache.get(key);
  const seen = new Set();
  const lines = [];
  for (const command of commands.values()) {
    if (seen.has(command)) continue;
    seen.add(command);
    if (!isAllowedCommand(command, senderIsOwner)) continue;
    const aliases = command.aliases && command.aliases.length ? ` [aliases: ${command.aliases.join(', ')}]` : '';
    lines.push(`- ${command.name}${aliases}: ${String(command.description || '').replace(/\s+/g, ' ').trim()}`);
  }
  const text = lines.join('\n');
  catalogCache.set(key, text);
  return text;
}

function buildPrompt(catalog) {
  return `You are the command router for a WhatsApp group-admin bot called BlueHunter. A group admin wrote a casual request addressed to the bot (it may be in English or Pidgin). Pick the ONE bot command that fulfils it, or "none".

Available commands (name, aliases, usage/description):
${catalog}

Rules:
- "command" is the command name only (no slash). "args" is exactly what would be typed after the command name, e.g. "on", "all", "Fun Zone", "233501234567". Use "" if none.
- People are targeted by tagging, replying, or a shared contact - the system handles that, so do NOT put @tags or names in args. Only put a phone number in args for add/approve/decline when the request itself contains one, in full international digits without + or leading 0.
- "lock the group / close the group / stop people chatting / only admins can talk" = close. "unlock / open the group / let everyone chat" = open. "lock group info / lock settings / stop people editing the name or icon" = lock, and unlocking that = unlock.
- If a duration is given for closing ("for 10 mins", "for an hour", "30 minutes"), put the number of minutes in "minutes" (otherwise 0).
- "who is requesting to join / pending requests" = requests. "approve everyone / accept all requests" = approve with args "all". "reject all" = decline with args "all".
- "reveal view once / show view once pictures" = antiviewonce on (off to stop it). "show AI cases / AI strikes for this person" = aicases. Settings toggles (antilink, antispam, aimoderation, antibot ...) take "on" or "off".
- If the request is chit-chat, a question for the bot, not an admin action, unclear, or not covered by a command above, answer "none". Never invent a command.

Respond with ONLY strict JSON: {"command": "name or none", "args": "", "minutes": 0}`;
}

async function react(sock, waMessage, emoji) {
  try {
    await sock.sendMessage(waMessage.key.remoteJid, { react: { text: emoji, key: waMessage.key } });
  } catch (err) {
    logger.warn('Could not react to request:', err.message);
  }
}

/**
 * Returns true when the message was a BlueHunter admin request that was handled
 * (or refused), false when message.js should carry on with the normal pipeline.
 * `runCommand(syntheticMsg)` runs the command through message.js's own
 * handleCommand, so permissions/cooldowns/audit all apply.
 */
async function maybeHandleNaturalCommand({ sock, waMessage, chat, msg, senderId, settings, senderIsAdmin, senderIsOwner, commands, runCommand }) {
  if (!chat.isGroup || (!senderIsAdmin && !senderIsOwner)) return false;
  if ((msg.body || '').startsWith(settings.prefix)) return false;

  const request = extractRequest(msg.body, botIsMentioned(sock, waMessage));
  if (!request) return false;

  const target = resolveTarget({ sock, chat, waMessage, request });
  const hints = [
    `Replying to a message: ${target?.source === 'reply' || target?.source === 'contact' ? 'yes' : 'no'}`,
    `Replying to a shared contact card: ${target?.source === 'contact' ? 'yes' : 'no'}`,
    `Someone tagged: ${target?.source === 'mention' ? 'yes' : 'no'}`,
    `Phone number written in the request: ${phoneFromText(request) || 'none'}`,
  ].join('\n');

  const intent = await getCommandIntent(buildPrompt(buildCatalog(commands, senderIsOwner)), `${hints}\nRequest: ${request}`);
  const name = String(intent?.command || '').toLowerCase().replace(/^\//, '').trim();
  if (!name || name === 'none') return false;

  const command = commands.get(name);
  if (!isAllowedCommand(command, senderIsOwner)) return false;

  let args = String(intent.args || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (args.startsWith(settings.prefix)) args = args.slice(settings.prefix.length).trim();

  // Needs-a-person commands: make sure we actually know who.
  const wantsAll = /^all$/i.test(args);
  const hasNumberArg = /\d{8,}/.test(args);
  if (NUMBER_ARG_COMMANDS.has(command.name) && !wantsAll && !hasNumberArg && target?.digits) {
    args = target.digits;
  }
  const needsTarget =
    (TARGET_COMMANDS.has(command.name) && !wantsAll && !hasNumberArg) ||
    (command.name === 'add' && !/\d{8,}/.test(args));
  if (needsTarget && !target) {
    await react(sock, waMessage, '❌');
    await msg.reply(
      command.name === 'add'
        ? 'Share the contact or type the number (full international format) of who to add.'
        : "Reply to the person's message, tag them, or reply to their shared contact."
    );
    return true;
  }

  if (command.requiresBotAdmin && !isBotAdmin(chat, sock)) {
    await react(sock, waMessage, '❌');
    await msg.reply('⚠️ I need to be an admin in this group to do that.');
    return true;
  }

  if (!senderIsOwner && cooldown.getRemaining(senderId, chat.id._serialized) > 0) {
    await react(sock, waMessage, '⏳');
    return true;
  }

  await react(sock, waMessage, '✅');

  const synth = Object.create(msg);
  Object.defineProperty(synth, 'body', { value: `${settings.prefix}${command.name}${args ? ` ${args}` : ''}` });
  if (target && TARGET_COMMANDS.has(command.name)) {
    Object.defineProperty(synth, '_targetOverride', { value: target.jid });
  }

  logger.info(`[bluehunter-nl] ${senderId} in ${chat.id._serialized}: "${request}" -> ${synth.body}`);
  await runCommand(synth);

  // "lock this group for 10 mins": close now, reopen automatically later.
  const minutes = clampMinutes(intent.minutes);
  if (command.name === 'close' && minutes > 0) {
    await GroupSettings.findOneAndUpdate(
      { groupId: chat.id._serialized },
      { reopenAt: new Date(Date.now() + minutes * 60_000) },
      { upsert: true }
    );
  }
  return true;
}

module.exports = { maybeHandleNaturalCommand, extractRequest, clampMinutes, phoneFromText, vcardDigits, isAllowedCommand };
