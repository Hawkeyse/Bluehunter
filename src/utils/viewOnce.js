const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { unwrapMessage } = require('./mediaContent');
const logger = require('./logger');

/**
 * If this message is view-once media, downloads it and resends the actual
 * file into the same chat (as a normal, non-view-once message), exposing
 * both the sender and the content. Returns true if it handled a view-once
 * message (whether or not the download itself succeeded).
 *
 * NOTE: there's no such thing as a "link" to WhatsApp media - it's end-to-end
 * encrypted and only downloadable with the message's own media key, which we
 * already have here. So the only real options are "resend the actual file"
 * or "tell the group it happened but couldn't be recovered" - there's no
 * middle-ground link to hand out.
 */
async function maybeRevealViewOnce({ sock, waMessage, chat, senderId }) {
  const { inner, isViewOnce } = unwrapMessage(waMessage.message);
  // audioMessage covers view-once voice notes (WhatsApp's newer "view once"
  // toggle for voice messages, distinct from image/video view-once) - inner
  // still needs isViewOnce true (checked below), same as image/video.
  const hasMedia = !!(inner?.imageMessage || inner?.videoMessage || inner?.audioMessage);

  if (!hasMedia || !isViewOnce) {
    if (hasMedia && !isViewOnce && process.env.DEBUG_VIEWONCE === '1') {
      logger.info(
        '[antiviewonce debug] media seen but not flagged view-once, top-level keys:',
        Object.keys(waMessage.message || {}).join(','),
        '| viewOnce flags: image=', inner?.imageMessage?.viewOnce,
        'video=', inner?.videoMessage?.viewOnce,
        'audio=', inner?.audioMessage?.viewOnce,
        '| contextInfo.expiration=', inner?.imageMessage?.contextInfo?.expiration ?? inner?.videoMessage?.contextInfo?.expiration
      );
    }
    return false;
  }

  const chatJid = chat.id._serialized;
  const tag = `@${senderId.split('@')[0]}`;
  const mediaType = inner.imageMessage ? 'image' : inner.videoMessage ? 'video' : 'audio';

  try {
    // downloadMediaMessage already unwraps ephemeral/viewOnce layers itself -
    // pass the original message straight through, same as unwrapMessage does.
    // The 4th arg lets Baileys request a fresh reupload and retry once if the
    // media's CDN link has already expired, instead of failing outright.
    const buffer = await downloadMediaMessage(waMessage, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
    const caption = `👁️ View-once media from ${tag} - revealed by antiviewonce.`;

    if (mediaType === 'image') {
      await sock.sendMessage(chatJid, { image: buffer, caption, mentions: [senderId] });
    } else if (mediaType === 'video') {
      await sock.sendMessage(chatJid, { video: buffer, caption, mentions: [senderId] });
    } else {
      // Audio messages have no caption field in WhatsApp's protocol, so the
      // attribution has to go as a separate text message instead.
      await sock.sendMessage(chatJid, { text: caption, mentions: [senderId] });
      await sock.sendMessage(chatJid, { audio: buffer, mimetype: inner.audioMessage.mimetype || 'audio/ogg; codecs=opus', ptt: true });
    }
  } catch (err) {
    logger.warn('Failed to download view-once media:', err.message);
    // No real "link" fallback exists for encrypted WA media - just flag that it happened.
    await sock.sendMessage(chatJid, {
      text: `👁️ ${tag} sent view-once media, but I couldn't download it to reveal here.`,
      mentions: [senderId],
    });
  }

  return true;
}

module.exports = { maybeRevealViewOnce };