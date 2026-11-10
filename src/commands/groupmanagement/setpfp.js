const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = {
  name: 'setpfp',
  category: 'groupmanagement',
  description: '/setpfp - reply to an image (or send one with this as the caption) to set the group photo',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat }) {
    const raw = msg._raw;
    let targetMessage = raw;

    // If replying to an image instead of attaching one directly, build a
    // minimal message object pointing at the quoted image so downloadMediaMessage
    // can fetch it the same way either way.
    const quoted = raw.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!raw.message?.imageMessage && quoted?.imageMessage) {
      targetMessage = {
        key: {
          remoteJid: raw.key.remoteJid,
          id: raw.message.extendedTextMessage.contextInfo.stanzaId,
          participant: raw.message.extendedTextMessage.contextInfo.participant,
        },
        message: quoted,
      };
    }

    if (!targetMessage.message?.imageMessage) {
      return msg.reply('Send an image with /setpfp as the caption, or reply to an image with /setpfp.');
    }

    try {
      const buffer = await downloadMediaMessage(targetMessage, 'buffer', {});
      await client.updateProfilePicture(chat.id._serialized, buffer);
      await msg.reply('✅ Group photo updated.');
    } catch (err) {
      await msg.reply(`❌ Failed to update group photo: ${err.message}`);
    }
  },
};