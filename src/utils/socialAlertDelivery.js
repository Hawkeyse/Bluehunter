const { randomBytes } = require('crypto');
const { generateWAMessage, proto } = require('@whiskeysockets/baileys');

const GROUP_STATUS_DESTINATION = 'groupStatus';

async function sendSocialAlert(sock, watch, content) {
  if (watch.destination !== GROUP_STATUS_DESTINATION) {
    return sock.sendMessage(watch.groupId, content);
  }

  if (!watch.groupId?.endsWith('@g.us')) {
    throw new Error('Group Status alerts require a WhatsApp group JID.');
  }
  if (typeof sock.relayMessage !== 'function') {
    throw new Error('This Baileys connection cannot relay Group Status posts.');
  }

  const userJid = sock.user?.id;
  if (!userJid) {
    throw new Error('Could not determine the connected WhatsApp account JID for Group Status.');
  }

  const contentType = content.text ? 'text' : content.image ? 'image' : content.video ? 'video' : null;
  if (!contentType) {
    throw new Error('Group Status alerts support text, image, and video messages only.');
  }
  if (contentType !== 'text' && typeof sock.waUploadToServer !== 'function') {
    throw new Error('This Baileys connection cannot upload Group Status media.');
  }

  const generated = await generateWAMessage(watch.groupId, content, {
    userJid,
    upload: sock.waUploadToServer,
    logger: sock.logger,
    mediaCache: sock.mediaCache,
    jid: watch.groupId,
    ...(content.text ? { backgroundColor: '#233E4F', font: 6 } : {}),
  });
  if (!generated.message || !generated.key?.id) {
    throw new Error('Baileys did not generate the Group Status message.');
  }

  const messageType = contentType === 'text'
    ? 'extendedTextMessage'
    : `${contentType}Message`;
  if (!generated.message[messageType]) {
    throw new Error(`Baileys did not generate the requested Group Status ${contentType} content.`);
  }

  const statusMessage = proto.Message.create({
    messageContextInfo: { messageSecret: randomBytes(32) },
    groupStatusMessage: { message: generated.message },
  });

  return sock.relayMessage(watch.groupId, statusMessage, {
    messageId: generated.key.id,
    useCachedGroupMetadata: false,
    ...(contentType !== 'text' ? { additionalAttributes: { mediatype: contentType } } : {}),
    additionalNodes: [{
      tag: 'meta',
      attrs: { is_group_status: 'true', origin: 'group_status' },
    }],
  });
}

module.exports = { sendSocialAlert, GROUP_STATUS_DESTINATION };
