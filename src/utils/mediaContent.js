/**
 * WhatsApp wraps message content in "future-proof" layers, and they can
 * stack - e.g. a view-once image in a chat with disappearing messages
 * enabled arrives as ephemeralMessage -> viewOnceMessageV2 -> imageMessage,
 * not just one layer. Unwrap every layer Baileys itself knows about
 * (mirroring its internal getFutureProofMessage list) until real content is
 * reached, tracking whether a view-once wrapper appeared anywhere in the chain.
 *
 * Both antiviewonce (viewOnce.js) and AI moderation (aiModeration.js) use
 * THIS SAME function on purpose - two separate unwrap implementations
 * drifting out of sync is exactly what caused the original antiviewonce bug.
 */
function unwrapMessage(message) {
  let current = message;
  let isViewOnce = false;
  // True when this message reached the group via WhatsApp's real "you were
  // mentioned in a status" share feature - it wraps the actual shared content
  // (image/text/whatever) in groupStatusMentionMessage (group chats) or
  // statusMentionMessage (DMs), a FutureProofMessage: { message: <real message> },
  // same shape as ephemeralMessage. Baileys' own normalizeMessageContent does
  // NOT unwrap this wrapper, so without unwrapping it here, every check that
  // reads message text/media (antilink, badwords, AI moderation, antigroupstatus
  // itself, etc.) sees nothing and the message sails through untouched.
  let isStatusMention = false;
  let guard = 0; // safety cap - real chains are 1-2 layers deep, never more

  while (current && guard < 5) {
    guard++;

    const viewOnceWrapper = current.viewOnceMessage || current.viewOnceMessageV2 || current.viewOnceMessageV2Extension || current.viewOnceMessageV2Extension;
    if (viewOnceWrapper) {
      isViewOnce = true;
      current = viewOnceWrapper.message || viewOnceWrapper;
      continue;
    }

    const statusMentionWrapper = current.groupStatusMessage || current.groupStatusMentionMessage || current.statusMentionMessage;
    if (statusMentionWrapper) {
      isStatusMention = true;
      current = statusMentionWrapper.message || statusMentionWrapper;
      continue;
    }

    const otherWrapper = current.ephemeralMessage || current.documentWithCaptionMessage || current.editedMessage || current.messageContextInfo || current.groupMentionedMessage;
    if (otherWrapper && otherWrapper.message) {
      current = otherWrapper.message;
      continue;
    }

    break;
  }

  if (!current) return { inner: null, isViewOnce: false, isStatusMention };

  // Newer format has no wrapper at all - just a `viewOnce: true` flag
  // directly on the image/video/audio message.
  if (!isViewOnce && (current.imageMessage?.viewOnce || current.videoMessage?.viewOnce || current.audioMessage?.viewOnce)) {
    isViewOnce = true;
  }

  return { inner: current, isViewOnce, isStatusMention };
}

/**
 * Pulls out whatever's inspectable from a raw Baileys message, after
 * unwrapping any ephemeral/view-once layers. Shared by AI moderation and the
 * baseline safety check so both cover view-once content, not just plain
 * messages. Returns null for types nothing here covers (contact cards,
 * polls, location pins, etc.).
 */
function extractMessageContent(waMessage) {
  const { inner } = unwrapMessage(waMessage.message);
  if (!inner) return null;

  if (inner.imageMessage) return { kind: 'image', caption: inner.imageMessage.caption || '', mimetype: inner.imageMessage.mimetype || 'image/jpeg', fileLength: Number(inner.imageMessage.fileLength) || 0 };
  if (inner.stickerMessage) return { kind: 'sticker', caption: '', mimetype: inner.stickerMessage.mimetype || 'image/webp', fileLength: Number(inner.stickerMessage.fileLength) || 0 };
  if (inner.videoMessage) {
    // NOTE: only the embedded thumbnail frame is judged, never the actual
    // video or its audio track - there's no cheap way to do real video/audio
    // moderation here. Best-effort proxy, not full coverage. The thumbnail
    // itself is always a real JPEG regardless of the video's own mimetype.
    return { kind: 'video', caption: inner.videoMessage.caption || '', thumbnail: inner.videoMessage.jpegThumbnail || null, mimetype: 'image/jpeg' };
  }
  if (inner.audioMessage) {
    return { kind: 'voice', mimetype: inner.audioMessage.mimetype || '' };
  }
  if (inner.documentMessage) {
    return {
      kind: 'document',
      caption: inner.documentMessage.caption || '',
      fileName: inner.documentMessage.fileName || '',
      mimetype: inner.documentMessage.mimetype || '',
    };
  }

  const text = inner.conversation || inner.extendedTextMessage?.text || '';
  if (text) return { kind: 'text', text };

  return null;
}

function isExpectedMediaDownloadFailure(err) {
  const raw = err && (err.message || err.toString ? err.toString() : String(err));
  if (!raw) return false;

  const text = String(raw).toLowerCase();
  const expectedPatterns = [
    'bad decrypt',
    'decrypt failed',
    'decrypt error',
    'invalid media key',
    'unable to decrypt',
    'unable to fetch media',
    'not a valid media message',
    'media key not found',
  ];

  return expectedPatterns.some((pattern) => text.includes(pattern));
}

/**
 * True if this message is a WhatsApp group-status post/share, including the
 * no-mention groupStatusMessage format and older status-mention wrappers.
 */
function isGroupStatusMention(waMessage) {
  if (waMessage?.isMentionedInStatus) return true;
  if (waMessage?.key?.remoteJid === 'status@broadcast') return true;
  // Someone shared their (or someone else's) Status straight into the chat via
  // Status > Share > pick this group - no @mention involved at all. WhatsApp
  // attaches this as a sibling field on the envelope (WebMessageInfo), not a
  // wrapper around message.message, so it sits alongside a normal-looking
  // image/video/text message rather than hiding it.
  if (waMessage?.statusMentionMessageInfo?.quotedStatus) return true;
  return unwrapMessage(waMessage?.message).isStatusMention;
}

module.exports = { isGroupStatusMention, unwrapMessage, extractMessageContent, isExpectedMediaDownloadFailure };