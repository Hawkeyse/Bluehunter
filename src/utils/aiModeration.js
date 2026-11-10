const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { createWarning, countWarnings } = require('./warnStore');
const { getModerationVerdict, transcribeAudio } = require('./openaiClient');
const { extractMessageContent, unwrapMessage, isExpectedMediaDownloadFailure } = require('./mediaContent');
const { CONTEXT_INFO_KEYS } = require('./antiforward');
const {
  MEDIATE_AT,
  STRIKE_AT,
  recordConflictFlag,
  resetConflictFlags,
  canMediate,
  markMediated,
  canAnnounce,
  markAnnounced,
} = require('./conflictTracker');
const logger = require('./logger');
const audit = require('./auditLog');

// Human-like moderation is deliberately conservative: if the message is
// harmless or ambiguous, the bot should let it through instead of acting like a
// punishment system. AI moderation still records strikes separately from the
// manual /warn system, but the auto-kick threshold is higher to avoid abuse.
const AI_AUTO_KICK_THRESHOLD = 3;

const EVIDENCE_DIR = path.join(__dirname, '..', '..', 'moderation-evidence');

function buildModerationPrompt(groupDescription) {
  return `You are the moderator of a WhatsApp group. Be a calm, patient, easy-going human moderator who has read the whole conversation - not an automated judge scanning one message in isolation. Your default answer is NO VIOLATION. You only act when something is clearly, unambiguously over the line, never because it could be read that way if you squint, and never just because it is negative.

Group rules (from the group description, set by the group's own admins) are your PRIMARY standard. Read the description carefully first: it tells you the tone of this group, what is allowed and what is not. Follow it calmly over any stricter instinct of your own. If the description is silent on something, stay lenient.
"""
${groupDescription || 'No description has been set. In the absence of written rules, use a calm, human standard: do not punish normal conversation, self-introductions, greetings, casual chats, jokes, friendly banter, venting, or harmless personal details. Only act on clear harms: hate speech, sexual content, explicit threats, slurs, scams, spam, doxxing, targeted harassment, or graphic violence.'}
"""

Stay calm about negativity. People get annoyed, complain, vent, argue, sulk, swear in frustration, and fall out with each other - this is normal group life and is NOT a violation by itself. This includes members who have beef with an admin or the group's leadership: complaining about an admin, disagreeing with their decisions, calling them out, being sarcastic, or being angry at them is allowed. Do not take the admin's side and do not treat criticism of admins as disrespect. Let people cool down on their own. Only step in when a fight has clearly gone far, meaning one of: explicit threats, slurs or hate speech, doxxing or sharing private details, sexual harassment, or a sustained, vicious, purely personal attack with no point other than to wound. A single harsh line, a heated reply, or a back-and-forth argument is NOT that.

You will often be given context above the message itself, showing what it is a REPLY to (an earlier text, image, sticker, video, voice note, or document). Use that context the way a human reading the thread would - it usually explains WHY something was sent. Many groups run an "introduce yourself" flow where admins ask new members to reply with their name, age, location, and a photo of themselves. A message replying to that kind of prompt is an ordinary introduction, not something to scrutinize harder - judge it exactly as calmly as any other normal message.

Hard rule: greetings, introductions, self-identification, and casual chat are not violations by themselves (for example: "hi", "hello", "my name is John", "I am 13 years old", "I am from Lagos"). Only flag it if it clearly crosses into explicit sexual content, graphic violence, hate speech, threats, scams, targeted abuse, or a specific rule violation written in the group description.

Photos and videos of real people (selfies, intro photos, everyday pictures, gym photos, beach or swimwear photos, group photos, photos showing arms/legs/midriff/etc.) are NORMAL and must NOT be flagged just for showing a person, showing skin, or being a photo of someone's body in ordinary clothing or swimwear. Only flag an image or video for sexual content if it unambiguously shows nudity (genitals, exposed breasts/buttocks) or an explicit sexual act - not suggestiveness, not a swimsuit, not a low-cut top, not a shirtless photo. If you are judging a single video thumbnail frame, remember it is one frame out of many and may look different from the full video in a misleading way - weigh that uncertainty toward NOT flagging unless the frame itself is unambiguous. When you are genuinely unsure whether an image crosses the line, you are not sure enough - do not flag it.

There are two different kinds of violations - tell them apart:
- "conflict": the sender is attacking ANOTHER member (or an admin) in a personal way and it has clearly gone far (see above). For these, do NOT take either side - you are not here to judge who is right. Use severity "high" only when it has really gone far; anything milder is severity "low".
- "content": everything else - hate speech, sexual/explicit content, explicit threats, scams, spam, doxxing, or a clear group-rule violation.

Important: if something is merely rude, annoying, sarcastic, negative, angry, casual slang, a joke, a disagreement, a complaint about an admin, revealing clothing, a normal photo, or borderline wording/imagery without clear, unambiguous harm, it is NOT a violation. Getting this wrong by removing something innocent is much worse than letting a borderline case pass - when in doubt, choose no violation.

Members of this group may write in Pidgin English (e.g. Nigerian or Ghanaian Pidgin) alongside standard English, sometimes mixed in the same message. Judge Pidgin the same way you'd judge standard English: by actual meaning and intent, not by the roughness of the wording. Ordinary Pidgin expressions, slang, and exclamations (e.g. "you dey craze", "no vex", "wahala", "abeg", "shine your eye") are normal informal speech, not hostility or profanity on their own - only flag them if the underlying meaning is genuinely abusive, threatening, hateful, or otherwise breaks the rules above.

Respond with ONLY strict JSON, no other text, in this exact shape:
{"violation": true or false, "category": "conflict" or "content" or "none", "severity": "low" or "high", "reason": "one short sentence explaining why, or empty string if no violation", "mediationMessage": "if category is conflict, a short, warm, neutral message asking everyone to calm down without blaming anyone specifically - otherwise empty string"}`;
}

function detectUnderageViolation(text = '') {
  if (!text || typeof text !== 'string') return false;

  const normalized = text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9\s'<>-]/g, ' ');
  if (!normalized.trim()) return false;

  const explicitUnder13 = /(under|below|less than|younger than|not even|before|underage)\s*(?:than\s+)?(?:13|thirteen)/.test(normalized);
  if (explicitUnder13) return true;

  const ageMatches = [...normalized.matchAll(/\b(?:i\s*(?:am|[' ]?m)|i\s+was|im|i\s+will\s+be)\s*(?:only\s+)?(\d{1,2})\s*(?:years?|yrs?|y\s*\/\s*o)\s*(?:old)?\b/g)];
  if (ageMatches.length) {
    const ages = ageMatches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value));
    if (ages.some((age) => age < 13)) return true;
  }

  const directAge = normalized.match(/\b(?:0?[0-9]|1[0-2])\s*(?:years?|yrs?|y\s*\/\s*o)\s*old\b/);
  if (directAge) {
    const age = Number(directAge[0].match(/\d+/)?.[0]);
    if (Number.isFinite(age) && age < 13) return true;
  }

  return false;
}

/**
 * Groups routinely ask new members to reply to an "introduce yourself" pinned
 * message with their name/age/location/photo. Judged with zero context, an
 * ordinary intro photo or a message that only makes sense as an answer to
 * something can look ambiguous or get misread - this is precisely how normal
 * introductions were getting removed as "NSFW" or "inappropriate". Pulling in
 * what the message is actually REPLYING to gives the model the same context
 * a human moderator reading the thread would have.
 *
 * Reuses extractMessageContent on the quoted message itself (same shape as
 * any other message), so this stays a thin wrapper, not new parsing logic.
 */
function getQuotedContent(waMessage) {
  const { inner } = unwrapMessage(waMessage?.message);
  if (!inner) return null;
  for (const key of CONTEXT_INFO_KEYS) {
    const quoted = inner[key]?.contextInfo?.quotedMessage;
    if (quoted) return extractMessageContent({ message: quoted });
  }
  return null;
}

function describeQuotedContent(quoted) {
  if (!quoted) return '';
  const trimmedCaption = (quoted.caption || '').slice(0, 200);
  switch (quoted.kind) {
    case 'text':
      return `This message is a REPLY to an earlier message that said: "${(quoted.text || '').slice(0, 300)}"`;
    case 'image':
      return `This message is a REPLY to an image${trimmedCaption ? ` captioned: "${trimmedCaption}"` : ' (no caption)'}.`;
    case 'sticker':
      return 'This message is a REPLY to a sticker.';
    case 'video':
      return `This message is a REPLY to a video${trimmedCaption ? ` captioned: "${trimmedCaption}"` : ' (no caption)'}.`;
    case 'voice':
      return 'This message is a REPLY to a voice note.';
    case 'document':
      return `This message is a REPLY to a document (filename: "${quoted.fileName || 'unknown'}").`;
    default:
      return '';
  }
}

/**
 * Returns a verdict object if this message violates the group's rules, or
 * null if it's clean, unsupported, or moderation itself failed. Fails open
 * on every error path - a broken download/transcription/API call should
 * never block or delete a message on its own.
 */
async function moderateMessage({ sock, waMessage, chat }) {
  const content = extractMessageContent(waMessage);
  if (!content) return null;

  let imageBase64;
  let imageMimetype;
  let userText = content.text || content.caption || '';
  let evidenceKind = content.kind;

  if (detectUnderageViolation(userText)) {
    return {
      reason: 'The user disclosed being under 13 years old. This is not allowed in the group.',
      category: 'content',
      mediationMessage: '',
      evidenceType: evidenceKind,
      evidenceText: userText,
      evidenceBase64: null,
    };
  }

  try {
    if (content.kind === 'image' || content.kind === 'sticker') {
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      imageBase64 = buffer.toString('base64');
      imageMimetype = content.mimetype;
    } else if (content.kind === 'video') {
      if (content.thumbnail) {
        imageBase64 = Buffer.from(content.thumbnail).toString('base64');
        imageMimetype = content.mimetype;
        userText = userText || '(video - judging its thumbnail frame only, not the full video or audio)';
      } else if (!userText) {
        return null; // no thumbnail and no caption - nothing to judge
      }
    } else if (content.kind === 'voice') {
      // Voice notes aren't vision content - transcribe first, then moderate
      // the transcript like any other text. Separate billable API call.
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      const transcript = await transcribeAudio(buffer, content.mimetype);
      if (!transcript) return null; // couldn't transcribe - fail open
      userText = `(voice note transcript) ${transcript}`;
    } else if (content.kind === 'document') {
      if ((content.mimetype || '').startsWith('image/')) {
        // An image sent as a "document" (common for full-quality photos) -
        // moderate it the same as a normal image.
        const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
        imageBase64 = buffer.toString('base64');
        imageMimetype = content.mimetype;
        userText = content.caption || content.fileName || '';
        evidenceKind = 'image';
      } else {
        // No content-level inspection for non-image documents (PDFs,
        // archives, executables, etc.) - judged on filename/caption/mimetype
        // text alone. Catches obviously-named scam/malware files, won't
        // catch something dangerous hiding behind an innocent name.
        userText = `(document, not opened - judging by filename/type/caption only) filename: "${content.fileName}", type: "${content.mimetype}", caption: "${content.caption}"`;
      }
    }
  } catch (err) {
    if (!isExpectedMediaDownloadFailure(err)) {
      logger.warn('AI moderation: failed to download/process media for review:', err.message);
    }
    return null;
  }

  // Give the model the same context a human moderator reading the thread
  // would have - what this message is actually replying to, if anything.
  const quotedContext = describeQuotedContent(getQuotedContent(waMessage));
  const textForModel = quotedContext ? `${quotedContext}\n\nThe message itself: ${userText || '(no text)'}` : userText;

  // Deliberately NOT wrapped in withTyping(): that helper holds for a minimum
  // of 7 seconds and shows "typing..." - fine for a chat reply, but for
  // moderation it delayed EVERY message (and every command behind it) by 7s
  // and made the bot appear to type in a group whenever anyone spoke.
  const verdict = await getModerationVerdict(buildModerationPrompt(chat.description), textForModel, imageBase64, imageMimetype);
  if (!verdict || !verdict.violation) return null;

  // Conflicts are only worth acting on once they have clearly gone far. A
  // mild or ambiguous one (venting, arguing, beef with an admin) is ignored.
  if (verdict.category === 'conflict' && verdict.severity !== 'high') return null;

  const isTextLikeEvidence = ['text', 'voice', 'document'].includes(evidenceKind);

  return {
    reason: (verdict.reason || 'Violates group rules.').slice(0, 300),
    category: verdict.category === 'conflict' ? 'conflict' : 'content',
    mediationMessage: verdict.mediationMessage || '',
    severity: verdict.severity === 'high' ? 'high' : 'low',
    evidenceType: evidenceKind,
    evidenceText: isTextLikeEvidence ? userText : '', // stored evidence stays the raw message text, not the quoted-context wrapper
    evidenceBase64: imageBase64 || null,
  };
}

function saveEvidence(evidenceBase64, evidenceType, senderId) {
  if (!evidenceBase64) return '';
  try {
    if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    // Video evidence is a JPEG thumbnail, not the original clip - stickers
    // keep their native webp format, everything else is a JPEG.
    const ext = evidenceType === 'sticker' ? 'webp' : 'jpg';
    const filename = `${Date.now()}-${senderId.split('@')[0]}.${ext}`;
    const filePath = path.join(EVIDENCE_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(evidenceBase64, 'base64'));
    return filePath;
  } catch (err) {
    logger.warn('Failed to save moderation evidence:', err.message);
    return '';
  }
}

/**
 * Deletes the violating message and records a Warning (source: 'ai') with
 * evidence attached. Deliberately quiet: no per-message "your message was
 * removed" announcement. The group only hears about it when it matters - one
 * short heads-up on the strike right before auto-kick, and the kick itself -
 * and even those are rate-limited per group so a busy fight never floods chat.
 */
async function applyAiModerationViolation({ chat, msg, senderId, verdict }) {
  const groupId = chat.id._serialized;
  const tag = `@${senderId.split('@')[0]}`;

  try {
    await msg.delete(true);
  } catch (err) {
    logger.warn('AI moderation: could not delete message:', err.message);
  }

  const evidencePath = saveEvidence(verdict.evidenceBase64, verdict.evidenceType, senderId);

  await createWarning({
    groupId,
    userId: senderId,
    reason: verdict.reason,
    moderatorId: 'ai-moderation',
    source: 'ai',
    evidenceType: verdict.evidenceType,
    evidenceText: verdict.evidenceText,
    evidencePath,
  });

  const count = await countWarnings(groupId, senderId, { source: 'ai' });
  logger.info(`[ai-moderation] strike ${count}/${AI_AUTO_KICK_THRESHOLD} for ${senderId} in ${groupId}: ${verdict.reason}`);

  if (count >= AI_AUTO_KICK_THRESHOLD) {
    try {
      await audit.runAs({ actorId: 'ai-moderation', source: 'auto', reason: `Reached ${AI_AUTO_KICK_THRESHOLD} AI-moderation strikes` }, () => chat.removeParticipants([senderId]));
      await chat.sendMessage(
        `🚫 ${tag} was removed after repeated rule violations.`,
        { mentions: [senderId] }
      );
    } catch (err) {
      logger.warn(`[ai-moderation] ${senderId} reached the strike limit in ${groupId} but could not be removed: ${err.message}`);
      if (canAnnounce(groupId)) {
        markAnnounced(groupId);
        await chat.sendMessage(`⚠️ ${tag} reached the strike limit but I need to be an admin to remove them.`, { mentions: [senderId] });
      }
    }
    return;
  }

  // One quiet heads-up on the last strike before a kick, so it is never a surprise.
  if (count === AI_AUTO_KICK_THRESHOLD - 1 && canAnnounce(groupId)) {
    markAnnounced(groupId);
    await chat.sendMessage(`⚠️ ${tag}, please keep it within the group rules - one more and you'll be removed.`, { mentions: [senderId] });
  }
}

/**
 * Entry point message.js calls for any flagged verdict.
 *
 * "content" violations go straight to the quiet delete+strike flow.
 *
 * "conflict" violations are handled patiently - the bot lets people argue
 * (including members who have beef with an admin) and only steps in once the
 * SAME person keeps going far. See conflictTracker.js for the thresholds:
 * silent at first, one calm-down note after repeated serious flags, and a
 * strike only if it keeps going after that.
 */
async function handleViolation({ chat, senderId, msg, verdict }) {
  const groupId = chat.id._serialized;

  if (verdict.category !== 'conflict') {
    await applyAiModerationViolation({ chat, msg, senderId, verdict });
    return;
  }

  const flagCount = recordConflictFlag(groupId, senderId);
  logger.info(`[ai-moderation] conflict flag ${flagCount} for ${senderId} in ${groupId}: ${verdict.reason}`);

  if (flagCount >= STRIKE_AT) {
    resetConflictFlags(groupId, senderId);
    await applyAiModerationViolation({
      chat,
      msg,
      senderId,
      verdict: { ...verdict, reason: `Kept attacking others after being asked to calm down: ${verdict.reason}` },
    });
    return;
  }

  if (flagCount === MEDIATE_AT && canMediate(groupId)) {
    markMediated(groupId);
    const text = verdict.mediationMessage || "Hey everyone, let's take a breath and keep things respectful 🙏";
    await chat.sendMessage(text);
    return;
  }

  // Anything else: leave it alone and let people cool down.
}

module.exports = { moderateMessage, handleViolation, AI_AUTO_KICK_THRESHOLD, detectUnderageViolation };