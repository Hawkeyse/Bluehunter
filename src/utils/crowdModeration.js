// Crowd-reaction moderation for dark jokes / offensive content.
//
// A single message can't tell you whether a dark joke landed badly - the
// group's reaction can. So instead of judging the joke up front, we remember
// recent messages and wait. When members complain ("wtf", "not funny", a
// negative emoji reaction...) about a message, we check it once with the AI
// (using the group description as the standard) and, if it really is offensive
// or in poor taste, quietly delete it. No strike, no announcement.
//
// Safeguards: admins' / owner's messages are never removed this way, harmless
// messages are left alone even if someone complains, and media with no text
// needs two different people complaining.

const { extractMessageContent, unwrapMessage } = require('./mediaContent');
const { getModerationVerdict } = require('./openaiClient');
const logger = require('./logger');

const BUFFER_TTL_MS = 5 * 60 * 1000; // how long a message stays "reactable"
const BUFFER_MAX = 40; // per group
const FALLBACK_TARGET_WINDOW_MS = 2 * 60 * 1000; // un-quoted complaints only look this far back
const MAX_COMPLAINT_LENGTH = 70; // complaints are short; long messages aren't reactions

const NEGATIVE_EMOJIS = new Set(['🤮', '🤢', '😡', '🤬', '😠', '👎']);

const COMPLAINT_RE = new RegExp(
  [
    '\\bwtf\\b', '\\bwth\\b', '\\bwtaf\\b', '\\btf\\b',
    'what the (?:f\\w*|hell|heck|fuck)',
    "(?:not|isn'?t|ain'?t|aint|no) funny", 'e no funny',
    "that'?s? (?:sick|disgusting|messed up|not okay|too much|too far|offensive|insensitive|wrong)",
    "this (?:is|one) (?:sick|disgusting|messed up|not okay|too much|too far|offensive|wrong)",
    '\\bdisgusting\\b', '\\boffensive\\b', '\\binsensitive\\b', 'bad taste', 'bad joke', 'too far',
    '(?:delete|remove|take down) (?:that|this|it)',
    'who (?:sent|posted|shared) (?:that|this)',
    'wetin be this', 'abeg delete',
    "you'?(?:re|r| are) sick", 'sick joke', 'dark joke', 'smh',
  ].join('|'),
  'i'
);

const buffers = new Map(); // groupId -> entry[]

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

function isComplaintText(text = '') {
  const t = (text || '').trim();
  return t.length > 0 && t.length <= MAX_COMPLAINT_LENGTH && COMPLAINT_RE.test(t);
}

function isNegativeReaction(emoji = '') {
  return NEGATIVE_EMOJIS.has((emoji || '').replace(/\uFE0F/g, ''));
}

function pruneGroup(groupId) {
  const list = buffers.get(groupId);
  if (!list) return [];
  const now = Date.now();
  const fresh = list.filter((e) => now - e.ts < BUFFER_TTL_MS).slice(-BUFFER_MAX);
  if (fresh.length) buffers.set(groupId, fresh);
  else buffers.delete(groupId);
  return fresh;
}

/** Remember a message so a later complaint can find it. */
function remember({ groupId, waMessage, msg, senderId, privileged }) {
  if (!waMessage?.key?.id) return;
  let content;
  try {
    content = extractMessageContent(waMessage);
  } catch (err) {
    return;
  }
  if (!content) return;
  const text = content.kind === 'text' ? content.text : content.caption || '';
  if (content.kind === 'text' && isComplaintText(text)) return; // complaints aren't targets
  if (content.kind === 'voice') return;

  const list = pruneGroup(groupId);
  list.push({
    id: waMessage.key.id,
    senderId,
    text,
    kind: content.kind,
    ts: Date.now(),
    privileged: !!privileged,
    msg,
    complainers: new Set(),
    checking: false,
    handled: false,
    cleared: false,
  });
  buffers.set(groupId, list.slice(-BUFFER_MAX));
}

function quotedIdOf(waMessage) {
  const { inner } = unwrapMessage(waMessage.message) || {};
  if (!inner) return null;
  for (const key of Object.keys(inner)) {
    const stanzaId = inner[key]?.contextInfo?.stanzaId;
    if (stanzaId) return stanzaId;
  }
  return null;
}

function findTarget(groupId, complainerId, quotedId) {
  const list = pruneGroup(groupId);
  if (quotedId) return list.find((e) => e.id === quotedId) || null;
  const now = Date.now();
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (now - e.ts > FALLBACK_TARGET_WINDOW_MS) break;
    if (normalize(e.senderId) !== normalize(complainerId)) return e;
  }
  return null;
}

function buildConfirmPrompt(groupDescription) {
  return `You are a calm, fair moderator of a WhatsApp group. Members just reacted negatively (for example "wtf", "not funny", or a disgusted emoji) to the message below. Decide whether the message really is a dark joke or offensive content that members could reasonably find offensive or in poor taste - for example jokes about death, tragedy, abuse, or illness, racist, sexist, or ableist jokes, slurs, or shock content.

Group rules (from the group description - your main standard):
"""
${groupDescription || 'No description set.'}
"""

Answer false (no violation) if: the group description says dark humour is fine; the message is ordinary, harmless, or merely rude banter; or the reaction seems to be about something else (an argument, surprising news, a normal opinion). Do not remove things just because someone complained.

Respond with ONLY strict JSON: {"violation": true or false, "category": "content", "reason": "one short sentence", "mediationMessage": ""}`;
}

async function evaluate({ chat, target }) {
  if (target.handled || target.privileged || target.checking) return;
  const crowd = target.complainers.size;
  if (crowd === 0) return;

  const hasText = !!target.text;
  if (!hasText && crowd < 2) return; // text-less media needs two people

  target.checking = true;
  try {
    if (hasText) {
      const verdict = await getModerationVerdict(
        buildConfirmPrompt(chat.description),
        `Message: """${target.text.slice(0, 1000)}"""\n${crowd} member(s) reacted negatively to it.`
      );
      if (!verdict || !verdict.violation) {
        target.cleared = true;
        return;
      }
      logger.info(`[crowd-moderation] removing a message after complaints (${crowd}): ${verdict.reason || 'offensive'}`);
    } else {
      logger.info(`[crowd-moderation] removing a ${target.kind} after complaints from ${crowd} members`);
    }
    target.handled = true;
    await target.msg.delete(true);
  } catch (err) {
    logger.warn('[crowd-moderation] check failed:', err.message);
  } finally {
    target.checking = false;
  }
}

async function registerComplaint({ chat, waMessage, complainerId, quotedId }) {
  const groupId = chat.id._serialized;
  const target = findTarget(groupId, complainerId, quotedId);
  if (!target || target.handled || target.cleared || target.privileged) return;
  if (normalize(target.senderId) === normalize(complainerId)) return;
  target.complainers.add(normalize(complainerId));
  await evaluate({ chat, target });
}

/** Call for every group message (after it passed normal moderation). */
async function handleComplaint({ chat, waMessage, msg, senderId }) {
  if (!isComplaintText(msg.body)) return false;
  await registerComplaint({ chat, waMessage, complainerId: senderId, quotedId: quotedIdOf(waMessage) });
  return true;
}

/** Call for reaction messages. Only negative emoji reactions count. */
async function handleReaction({ chat, waMessage, senderId }) {
  const { inner } = unwrapMessage(waMessage.message) || {};
  const reaction = inner?.reactionMessage;
  if (!reaction || !isNegativeReaction(reaction.text)) return false;
  await registerComplaint({ chat, waMessage, complainerId: senderId, quotedId: reaction.key?.id || null });
  return true;
}

function prune() {
  for (const groupId of [...buffers.keys()]) pruneGroup(groupId);
}

module.exports = { remember, handleComplaint, handleReaction, isComplaintText, isNegativeReaction, prune };
