const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { checkSafetyBaseline } = require('./openaiClient');
const { extractMessageContent, isExpectedMediaDownloadFailure } = require('./mediaContent');
const GroupSettings = require('../models/GroupSettings');
const logger = require('./logger');

// Zero-tolerance: any nonzero signal of sexual content involving minors
// leaves immediately. False positives here are far preferable to false
// negatives - do not raise this without a very good reason.
const SEXUAL_MINORS_THRESHOLD = 0.1;

// General pornographic content needs high confidence before leaving, so a
// borderline/suggestive joke or meme doesn't get a whole group abandoned.
// TUNE THIS based on beta feedback - this is the main knob to adjust if
// it's triggering too often or too rarely.
const SEXUAL_CONTENT_THRESHOLD = 0.85;

// Images/stickers bigger than this aren't downloaded for the baseline check.
// The check runs on every group message, and each download is held in memory
// (then copied again as base64 and again inside the request body).
const MAX_SAFETY_MEDIA_BYTES = 6 * 1024 * 1024;

const EXIT_MESSAGE = `⚠️ Automatic Exit
Inappropriate content was detected in this group. As a result, the bot has automatically left the group to comply with its safety policy.`;

function shouldLeaveForGeneralNsfw(settings) {
  return settings?.nsfwAllowed === false;
}

/**
 * Mandatory baseline safety net - runs on every group message REGARDLESS of
 * any per-group setting, including AI moderation being off. Uses OpenAI's
 * free moderation endpoint specifically so this can run unconditionally
 * everywhere without adding to API cost.
 *
 * Scope: images, video thumbnails, stickers, and text only. Voice notes and
 * documents are NOT covered here (that would need a paid transcription call
 * per message, which defeats the point of this being free and universal) -
 * they're only covered by the opt-in /aimoderation flow.
 *
 * Returns true if the bot left the group as a result - caller should stop
 * processing this message entirely.
 */
async function checkAndEnforceGroupSafety({ sock, waMessage, chat, senderId }) {
  const content = extractMessageContent(waMessage);
  if (!content || !['image', 'video', 'sticker', 'text'].includes(content.kind)) return false;

  let imageBase64;
  let imageMimetype;
  const text = content.text || content.caption || '';

  try {
    if ((content.kind === 'image' || content.kind === 'sticker') && content.fileLength > MAX_SAFETY_MEDIA_BYTES) {
      // Oversized file: skip the image (text/caption is still checked below)
      // rather than pulling several MB into memory for every such message.
      // Fails open, same as a download error.
    } else if (content.kind === 'image' || content.kind === 'sticker') {
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});
      imageBase64 = buffer.toString('base64');
      imageMimetype = content.mimetype;
    } else if (content.kind === 'video' && content.thumbnail) {
      imageBase64 = Buffer.from(content.thumbnail).toString('base64');
      imageMimetype = content.mimetype;
    }
  } catch (err) {
    if (!isExpectedMediaDownloadFailure(err)) {
      logger.warn('Group safety check: failed to download media:', err.message);
    }
    return false; // fail open - never block on an expected decrypt/download error
  }

  if (!text && !imageBase64) return false;

  const result = await checkSafetyBaseline(text, imageBase64, imageMimetype);
  if (!result) return false; // no API key, or the call failed - fail open

  const sexualMinorsScore = result.category_scores?.['sexual/minors'] || 0;
  const sexualScore = result.category_scores?.sexual || 0;

  // Sexual/minors is zero-tolerance and can NEVER be suppressed by any
  // per-group setting - see the threshold comment above. Only the general
  // adult-content leave respects the group's nsfwAllowed opt-out.
  const minorsFlag = sexualMinorsScore >= SEXUAL_MINORS_THRESHOLD;
  const sexualFlag = sexualScore >= SEXUAL_CONTENT_THRESHOLD;
  if (!minorsFlag && !sexualFlag) return false;

  if (!minorsFlag && sexualFlag) {
    const settings = await GroupSettings.findOne({ groupId: chat.id._serialized });
    if (!shouldLeaveForGeneralNsfw(settings)) return false;
  }

  logger.warn(
    `Group safety: leaving ${chat.id._serialized} - sexual/minors=${sexualMinorsScore.toFixed(3)}, sexual=${sexualScore.toFixed(3)}, sender=${senderId}`
  );

  try {
    await sock.sendMessage(chat.id._serialized, { text: EXIT_MESSAGE });
  } catch (err) {
    // still leave even if the notice fails to send
  }

  // Keep the GroupSettings doc (don't delete it) specifically so this flag
  // survives the bot leaving - it's what /allowgroup and the re-add redirect
  // in group_participants.js check against later.
  await GroupSettings.findOneAndUpdate(
    { groupId: chat.id._serialized },
    { autoLeftForSafety: true, autoLeftAt: new Date(), autoLeftGroupName: chat.name || '' },
    { upsert: true }
  );

  try {
    await sock.groupLeave(chat.id._serialized);
  } catch (err) {
    logger.error('Group safety: failed to leave group after flagging it:', err.message);
  }

  return true;
}

module.exports = { checkAndEnforceGroupSafety, shouldLeaveForGeneralNsfw, EXIT_MESSAGE, isExpectedMediaDownloadFailure };