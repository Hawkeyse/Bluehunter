const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getAiReply, getTtsAudio, transcribeAudio } = require('./openaiClient');
const { buildSystemPrompt, buildCommandReference, JOIN_GROUP_REPLY } = require('./aiPersonality');
const { getBotJid, getBotLid, withPresence, extractText, MIN_AI_TYPING_MS } = require('./waCompat');
const { extractMessageContent, unwrapMessage, isExpectedMediaDownloadFailure } = require('./mediaContent');
const { searchGif } = require('./giphyClient');
const { toStickerWebp } = require('./stickerMaker');
const { reserveAiChatAttempt } = require('./aiChatLimiter');
const {
  AI_REPLY_COOLDOWN_MS,
  AI_FOLLOWUP_COOLDOWN_MS,
  AI_AMBIENT_CHANCE,
  AI_AMBIENT_COOLDOWN_MS,
  GIPHY_API_KEY,
  OPENAI_API_KEY,
  YARNGPT_API_KEY,
  YARNGPT_TTS_VOICE,
  BOT_NAME,
} = require('../config');
const logger = require('./logger');

// Matches a trailing "[STICKER: query]" tag the model appends to react with
// a sticker - see the "Reacting with a sticker" section of aiPersonality.js
// for the exact protocol the model is instructed to follow. We accept a tiny
// bit of trailing punctuation as well, since models occasionally add a final
// period or similar after the tag.
const STICKER_TAG_RE = /\[STICKER:\s*([^\]]+)\](?:\s*[.!?])?\s*$/i;
// Matches a trailing "[VOICE]" tag the model appends to ask for its reply to
// be sent as a spoken voice note instead of text - see the "Replying with a
// voice note" section of aiPersonality.js.
const VOICE_TAG_RE = /\[VOICE\]\s*$/i;

/** Splits a raw model reply into its spoken text and an optional sticker
 * search query, per the STICKER tag protocol. */
function extractStickerRequest(reply) {
  const trimmed = (reply || '').trim();
  const match = STICKER_TAG_RE.exec(trimmed);
  if (!match) return { text: trimmed, stickerQuery: null };
  return { text: trimmed.slice(0, match.index).trim(), stickerQuery: match[1].trim() || null };
}

/** Splits a reply (already stripped of any sticker tag) into its spoken text
 * and whether the model asked for it to be sent as a voice note, per the
 * VOICE tag protocol. */
const VOICE_ASK_RE = /\b(voice ?note|voice ?message|voice reply|reply (?:in|by|with) voice|send (?:me )?(?:a )?voice|by voice|in voice|speak)\b/i;

function extractVoiceRequest(reply) {
  const match = VOICE_TAG_RE.exec(reply);
  if (!match) return { text: reply.trim(), wantsVoice: false };
  return { text: reply.slice(0, match.index).trim(), wantsVoice: true };
}

/** Best-effort: find a reaction gif on Tenor and send it as a sticker.
 * Failures here (no Tenor key, no results, conversion error) are swallowed -
 * a missing sticker should never be treated as a failed AI chat reply. */
async function sendStickerReaction(sock, groupId, query) {
  try {
    const gifBuffer = await searchGif(query);
    if (!gifBuffer) return;
    const stickerBuffer = await toStickerWebp(gifBuffer, { animated: true });
    await sock.sendMessage(groupId, { sticker: stickerBuffer, isAnimated: true });
  } catch (err) {
    logger.warn('AI chat sticker reaction failed:', err.message);
  }
}

// Someone asking the bot to join / be added to their group. Handled with a
// fixed reply (no OpenAI call) - only checked when the bot was addressed.
const GROUP_WORD = '(?:group|groups|grp|gc|gp|community)';
const BOT_WORD = '(?:you|u|ya|bot|bluehunter|blue\\s?hunter)';
const JOIN_REQUEST_PATTERNS = [
  // "add you to my group", "how do I add this bot to my gc", "abeg add bot my group"
  new RegExp(`\\b(?:add|invite|bring|put|drop|get|take)\\b[^.?!\\n]{0,40}\\b${BOT_WORD}\\b[^.?!\\n]{0,40}\\b${GROUP_WORD}\\b`, 'i'),
  // "can you join my group", "u fit come my gc", "make bot join our group"
  new RegExp(`\\b${BOT_WORD}\\b[^.?!\\n]{0,30}\\b(?:join|come|enter)\\b[^.?!\\n]{0,30}\\b${GROUP_WORD}\\b`, 'i'),
  // "join my group", "come to our gc" (my/our/another/new only, so "join this group" doesn't trigger)
  new RegExp(`\\b(?:join|come)\\b[^.?!\\n]{0,25}\\b(?:my|our|another|other|new)\\b[^.?!\\n]{0,15}\\b${GROUP_WORD}\\b`, 'i'),
  // "I want this bot in my group", "need bluehunter for my gc"
  new RegExp(`\\b(?:bot|bluehunter)\\b[^.?!\\n]{0,20}\\b(?:in|for|on|inside)\\b[^.?!\\n]{0,20}\\b(?:my|our)\\b[^.?!\\n]{0,15}\\b${GROUP_WORD}\\b`, 'i'),
];

function isGroupJoinRequest(text = '') {
  return JOIN_REQUEST_PATTERNS.some((re) => re.test(text));
}

// The bot's own last few replies per group, fed back into the prompt so it
// never repeats a comeback (the model has no memory between requests).
const recentBotReplies = new Map(); // groupId -> [text, ...]
const RECENT_REPLIES_KEPT = 4;
function rememberBotReply(groupId, text) {
  if (!text) return;
  const list = recentBotReplies.get(groupId) || [];
  list.push(text.slice(0, 200));
  while (list.length > RECENT_REPLIES_KEPT) list.shift();
  recentBotReplies.set(groupId, list);
}

const lastAmbientAt = new Map(); // groupId -> timestamp, for unprompted ambient replies

// The last thing the bot said, when that was a question. A human keeps a
// conversation going: once you have asked something, the answer is for you,
// even without another @mention. Set on every reply, cleared as soon as
// someone other than the person who asked answers it, and ignored after
// PENDING_QUESTION_TTL_MS so a stale question does not drag the bot into an
// unrelated chat long afterwards.
const pendingBotQuestion = new Map(); // groupId -> { at, sender }
const PENDING_QUESTION_TTL_MS = 5 * 60_000;

// True when a reply ends on a question - the bot handing the ball back to the
// chat, so a real answer deserves a response. Tolerates a trailing emoji.
const QUESTION_END_RE = /[?？][\s\p{Extended_Pictographic}\uFE0F\u200D]*$/u;
function looksLikeQuestion(text = '') {
  return QUESTION_END_RE.test((text || '').trim());
}

// Rolling per-group transcript, kept purely so the bot can answer "what are
// they talking about" / "catch me up" style questions with real context
// instead of just the single message that happens to address it. This is
// NOT sent to OpenAI on every message - only bundled in as context on the
// message that's actually about to get a reply (see buildHistoryBlock).
const recentHistory = new Map(); // groupId -> [{ sender, text, ts }]
const HISTORY_LIMIT = 30;

function normalize(id = '') {
  return id.toString().split('@')[0].split(':')[0];
}

/** Turns a mediaContent.extractMessageContent() result into a short, human
 * readable line for the rolling transcript - e.g. "[sent a sticker]" rather
 * than dropping media messages from the history entirely. */
function describeContent(content) {
  if (!content) return '';
  switch (content.kind) {
    case 'text':
      return content.text;
    case 'image':
      return content.caption ? `[image] ${content.caption}` : '[sent an image]';
    case 'sticker':
      return '[sent a sticker]';
    case 'video':
      return content.caption ? `[video] ${content.caption}` : '[sent a video]';
    case 'voice':
      return '[sent a voice note]';
    case 'document':
      return `[sent a document${content.fileName ? `: ${content.fileName}` : ''}]`;
    default:
      return '';
  }
}

/** Records every group message (when AI chat is on) into the rolling
 * transcript, regardless of whether this particular message ends up
 * triggering a reply - otherwise "what did I miss" questions would have
 * nothing to draw on. */
function recordMessage({ waMessage, chat, senderId, content }) {
  const text = describeContent(content);
  if (!text) return;

  const groupId = chat.id._serialized;
  const list = recentHistory.get(groupId) || [];
  list.push({ sender: normalize(senderId), text: text.slice(0, 300), ts: Date.now() });
  while (list.length > HISTORY_LIMIT) list.shift();
  recentHistory.set(groupId, list);
}

/** Formats everything in the rolling transcript EXCEPT the current message
 * (the caller adds that separately) as a context block for the prompt. */
function buildHistoryBlock(groupId) {
  const list = recentHistory.get(groupId) || [];
  const priorMessages = list.slice(0, -1);
  if (!priorMessages.length) return '';
  const lines = priorMessages.map((e) => `${e.sender}: ${e.text}`);
  return `Recent messages in this chat, oldest first:\n${lines.join('\n')}\n\n`;
}

/** contextInfo (mentions, quoted-reply) lives on whichever message type was
 * actually sent - extendedTextMessage for plain text, but each media type
 * (image/video/sticker/document/audio) carries its own top-level
 * contextInfo instead. Checking only extendedTextMessage meant an @mention
 * or reply-to-bot sent alongside a photo/video/sticker was never detected,
 * so the message fell through to the ambient path, which skips all
 * non-text content - i.e. the bot silently never "saw" tagged images. */
function getContextInfo(waMessage) {
  const { inner } = unwrapMessage(waMessage.message);
  if (!inner) return null;
  return (
    inner.extendedTextMessage?.contextInfo ||
    inner.imageMessage?.contextInfo ||
    inner.videoMessage?.contextInfo ||
    inner.stickerMessage?.contextInfo ||
    inner.documentMessage?.contextInfo ||
    inner.audioMessage?.contextInfo ||
    null
  );
}

/** True if this message @mentions the bot, or is a reply to a message the bot sent. */
function isAddressingBot(waMessage, sock) {
  const botJid = normalize(getBotJid(sock));
  const botLid = getBotLid(sock);
  const ctx = getContextInfo(waMessage);

  const mentioned = ctx?.mentionedJid || [];
  if (mentioned.some((j) => (botJid && normalize(j) === botJid) || (botLid && normalize(j) === normalize(botLid)))) return true;

  const quotedParticipant = ctx?.participant;
  if (quotedParticipant) {
    const qp = normalize(quotedParticipant);
    if ((botJid && qp === botJid) || (botLid && qp === normalize(botLid))) return true;
  }

  const text = extractText(waMessage);
  const botNumber = botJid.replace(/\D/g, '');
  if (botNumber && [...text.matchAll(/@([\d\s()+.-]+)/g)].some((match) => match[1].replace(/\D/g, '') === botNumber)) return true;

  const nameParts = (BOT_NAME || '').trim().split(/\s+/).filter(Boolean);
  if (nameParts.length) {
    const namePattern = nameParts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    if (new RegExp(`\\b@?${namePattern}\\b`, 'i').test(text)) return true;
  }

  return false;
}

/**
 * If this message also @mentions, or is a reply to, someone OTHER than the
 * bot itself, returns that person's jid - e.g. "@bot roast @Chidi" or
 * replying to Chidi's message while asking the bot to clown him. Lets the AI
 * address that person directly instead of vaguely, and lets the outgoing
 * reply actually @mention (ping) them - see roastTargetLabel in
 * aiPersonality.js and the mentions array in maybeHandleAiChat below.
 */
function resolveRoastTarget(waMessage, sock) {
  const botJid = normalize(getBotJid(sock));
  const botLid = getBotLid(sock);
  const isBot = (jid) => {
    const n = normalize(jid);
    return n === botJid || (botLid && n === normalize(botLid));
  };

  const ctx = getContextInfo(waMessage);
  if (!ctx) return null;

  const otherMentions = (ctx.mentionedJid || []).filter((j) => !isBot(j));
  if (otherMentions.length > 0) return otherMentions[0];

  if (ctx.participant && !isBot(ctx.participant)) return ctx.participant;

  return null;
}

/**
 * Returns true if it handled (and replied to) the message, false otherwise.
 *
 * Two paths:
 * - Addressed (mentioned/replied to): eligible subject to group and per-sender
 *   rate limits, with AI_REPLY_COOLDOWN_MS as the configurable group cooldown.
 *   The model may decide silence is more natural and return [[IGNORE]].
 *   Covers text, images, videos (thumbnail frame only), stickers, and voice
 *   notes (transcribed via Whisper first).
 * - Ambient (nobody addressed the bot): text only, disabled by default and
 *   eligible only with AI_AMBIENT_CHANCE probability. It shares the same
 *   group/sender safety limits as addressed replies.
 */
async function maybeHandleAiChat({ sock, waMessage, chat, senderId, settings, senderIsOwner, senderIsAdmin, commands }) {
  if (!settings?.aiChatEnabled) return false;

  const groupId = chat.id._serialized;
  const content = extractMessageContent(waMessage);
  recordMessage({ waMessage, chat, senderId, content });

  const now = Date.now();
  const addressed = isAddressingBot(waMessage, sock);

  // Somebody answering a question the bot itself just asked. That is a
  // conversation in progress, so it gets a reply without needing a fresh
  // @mention - the way talking to a person actually works.
  const pendingQuestion = pendingBotQuestion.get(groupId);
  const answeringBot =
    !addressed &&
    !!pendingQuestion &&
    !!content &&
    content.kind === 'text' &&
    normalize(senderId) !== pendingQuestion.sender &&
    now - pendingQuestion.at <= PENDING_QUESTION_TTL_MS;

  if (addressed) {
    if (!reserveAiChatAttempt(groupId, senderId, now, AI_REPLY_COOLDOWN_MS)) return false;
  } else if (answeringBot) {
    // A follow-up lands seconds later, so it uses the short follow-up
    // cooldown instead of the full group one.
    if (!reserveAiChatAttempt(groupId, senderId, now, AI_FOLLOWUP_COOLDOWN_MS, true)) return false;
    pendingBotQuestion.delete(groupId);
  } else {
    if (!content || content.kind !== 'text') return false; // don't ambient-react to stickers/media with no text to go on
    const lastAmbient = lastAmbientAt.get(groupId) || 0;
    if (now - lastAmbient < AI_AMBIENT_COOLDOWN_MS) return false;
    if (Math.random() > AI_AMBIENT_CHANCE) return false; // most eligible messages still get skipped
    if (!reserveAiChatAttempt(groupId, senderId, now, AI_REPLY_COOLDOWN_MS)) return false;
  }

  let imageBase64;
  let mediaNote = '';
  let voiceTranscript = '';
  try {
    if (content?.kind === 'image' || content?.kind === 'sticker') {
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      imageBase64 = buffer.toString('base64');
    } else if (content?.kind === 'video' && content.thumbnail) {
      imageBase64 = Buffer.from(content.thumbnail).toString('base64');
      mediaNote = "(this is a video - you're only seeing its thumbnail frame, not the full clip or audio)";
    } else if (content?.kind === 'voice') {
      // Voice notes aren't vision content - transcribe first (same Whisper
      // call AI moderation uses), then let the transcript flow through the
      // rest of the pipeline exactly like a normal text message.
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      const transcript = await transcribeAudio(buffer, content.mimetype);
      if (transcript) {
        voiceTranscript = transcript;
        mediaNote = '(this was sent as a voice note, transcribed automatically - may contain small transcription errors)';
      }
    }
  } catch (err) {
    if (!isExpectedMediaDownloadFailure(err)) {
      logger.warn('Failed to download media for AI chat:', err.message);
    }
  }

  const rawText = content?.text || content?.caption || voiceTranscript || '';
  const text = [mediaNote, rawText].filter(Boolean).join(' ');
  if (!text && !imageBase64) return false; // nothing to actually respond to

  if (addressed && rawText && isGroupJoinRequest(rawText)) {
    await sock.sendMessage(groupId, { text: JOIN_GROUP_REPLY }, { quoted: waMessage });
    return true;
  }

  const historyBlock = buildHistoryBlock(groupId);
  const roastTargetJid = resolveRoastTarget(waMessage, sock);
  const roastTargetLabel = roastTargetJid ? `@${normalize(roastTargetJid)}` : null;
  const userContent = `${historyBlock}Message just now from ${normalize(senderId)}: ${text || '(no caption, see attached)'}`;

  const commandReference = buildCommandReference(commands);
  const systemPrompt = buildSystemPrompt({
    isOwnerMessage: senderIsOwner,
    isGroupAdmin: senderIsAdmin,
    addressed,
    replyingToBot: answeringBot,
    commandReference,
    stickersAvailable: !!GIPHY_API_KEY,
    voiceAvailable: !!YARNGPT_API_KEY,
    roastTargetLabel,
    recentBotReplies: recentBotReplies.get(groupId) || [],
  });
  // Presence mirrors what is about to be sent: "recording..." for a voice
  // note, "typing..." for text. When someone explicitly asks for a voice note
  // we know up front, so recording shows for the whole wait (no typing->
  // recording flip). Otherwise it types while the model thinks and switches to
  // recording only if the model chose voice.
  const explicitVoiceAsk = !!YARNGPT_API_KEY && VOICE_ASK_RE.test(text || '');

  let rawReply = null;
  let replyText = '';
  let stickerQuery = null;
  let voiceBuffer = null;
  let ignored = false;

  const generate = async () => {
    rawReply = await getAiReply(systemPrompt, userContent, imageBase64);
    if (!rawReply) return;
    if (/^\s*\[\[IGNORE\]\]\s*$/i.test(rawReply)) {
      ignored = true;
      return;
    }
    const afterSticker = extractStickerRequest(rawReply);
    stickerQuery = afterSticker.stickerQuery;
    const parsed = extractVoiceRequest(afterSticker.text);
    replyText = parsed.text;
    const wantsVoiceNote = !!replyText && !!YARNGPT_API_KEY && (parsed.wantsVoice || explicitVoiceAsk);
    if (wantsVoiceNote && explicitVoiceAsk) {
      // Already showing "recording" - render the audio inside the same window.
      voiceBuffer = await getTtsAudio(replyText, YARNGPT_TTS_VOICE);
    } else if (wantsVoiceNote) {
      voiceBuffer = true; // marker: render below under its own recording presence
    }
  };

  // The long floor holds \"typing...\" (or \"recording...\") while the model thinks
  // AND while the answer is typed out, the way a person would, instead of the
  // old short blip followed by an answer that lands instantly.
  await withPresence(sock, groupId, explicitVoiceAsk ? 'recording' : 'composing', generate, MIN_AI_TYPING_MS);

  if (!rawReply) return false;
  if (ignored) {
    if (!addressed) lastAmbientAt.set(groupId, now);
    return true;
  }

  if (voiceBuffer === true) {
    voiceBuffer = await withPresence(sock, groupId, 'recording', () => getTtsAudio(replyText, YARNGPT_TTS_VOICE));
  }
  if (!voiceBuffer && (explicitVoiceAsk || (rawReply && VOICE_TAG_RE.test(rawReply)))) {
    logger.warn('A voice note could not be generated; sending the text reply instead.');
  }

  const mentions = roastTargetJid ? [roastTargetJid] : [];
  rememberBotReply(groupId, replyText);
  // If the bot just asked something, remember it so the answer comes back
  // through as conversational follow-up instead of a fresh mention.
  if (looksLikeQuestion(replyText)) pendingBotQuestion.set(groupId, { at: now, sender: normalize(senderId) });
  else pendingBotQuestion.delete(groupId);

  if (addressed) {
    if (voiceBuffer) {
      await sock.sendMessage(groupId, { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true, mentions }, { quoted: waMessage });
    } else if (replyText) {
      await sock.sendMessage(groupId, { text: replyText, mentions }, { quoted: waMessage });
    }
  } else {
    lastAmbientAt.set(groupId, now);
    // Ambient replies read more natural as a fresh message than a quoted reply.
    if (voiceBuffer) {
      await sock.sendMessage(groupId, { audio: voiceBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true, mentions });
    } else if (replyText) {
      await sock.sendMessage(groupId, { text: replyText, mentions });
    }
  }

  if (stickerQuery) await sendStickerReaction(sock, groupId, stickerQuery);

  return true;
}

module.exports = { maybeHandleAiChat, extractStickerRequest, isGroupJoinRequest, isAddressingBot };
