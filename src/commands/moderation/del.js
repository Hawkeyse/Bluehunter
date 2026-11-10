const { getTrackedMessage, recordDeletedMessage } = require('../../utils/deletedLogs');
const { getBotJid, getBotLid } = require('../../utils/waCompat');
const { unwrapMessage } = require('../../utils/mediaContent');

function getQuotedMessageKey(msg, client) {
  const { inner } = unwrapMessage(msg._raw?.message);
  if (!inner) return null;

  const content = inner.extendedTextMessage || inner.imageMessage || inner.videoMessage || inner.documentMessage;
  const context = content?.contextInfo;
  if (!context?.stanzaId) return null;

  const groupId = msg.from;
  const tracked = getTrackedMessage(groupId, context.stanzaId);
  if (tracked?.key) return tracked;

  const participant = context.participant;
  const botIds = [getBotJid(client), getBotLid(client)].filter(Boolean);
  const fromMe = !!participant && botIds.some((id) => id.split('@')[0].split(':')[0] === participant.split('@')[0].split(':')[0]);
  return {
    groupId,
    userId: participant || (fromMe ? getBotJid(client) : ''),
    messageId: context.stanzaId,
    text: '',
    mediaType: null,
    mediaBuffer: null,
    mediaMimeType: null,
    timestamp: new Date(),
    key: { remoteJid: groupId, id: context.stanzaId, participant, fromMe },
  };
}

module.exports = {
  name: 'del',
  aliases: ['delete'],
  category: 'moderation',
  description: '/del - delete the message you replied to',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat, senderId }) {
    const entry = getQuotedMessageKey(msg, client);
    if (!entry) return msg.reply('Reply to the message you want me to delete, then send /del.');

    try {
      await client.sendMessage(chat.id._serialized, { delete: entry.key });
      if (entry.userId) {
        recordDeletedMessage({
          groupId: chat.id._serialized,
          userId: entry.userId,
          messageId: entry.messageId,
          text: entry.text,
          mediaType: entry.mediaType,
          mediaBuffer: entry.mediaBuffer,
          mediaMimeType: entry.mediaMimeType,
          timestamp: entry.timestamp,
          deletedBy: senderId,
        });
      }
      return msg.reply('🗑️ Message deleted.');
    } catch (err) {
      return msg.reply(`❌ I couldn't delete that message. Make sure I am a group admin. (${err.message})`);
    }
  },
};
