const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { unwrapMessage, isExpectedMediaDownloadFailure } = require('../../utils/mediaContent');
const { transcribeAudio } = require('../../utils/openaiClient');
const { withTyping } = require('../../utils/waCompat');
const logger = require('../../utils/logger');

module.exports = {
  name: 'transcribe',
  aliases: ['tr', 'stt'],
  category: 'general',
  description: '/transcribe - reply to a voice note to get a text transcript (any language, including Pidgin)',
  async execute({ client, msg, chat }) {
    const raw = msg._raw;
    let targetMessage = raw;

    // A voice note can't be attached to the SAME message as a /transcribe
    // command (WhatsApp doesn't let you send media with a plain-text
    // command as its caption and have both work), so replying to it is the
    // only real way to point /transcribe at a specific voice note - same
    // pattern /setpfp uses for images. Build a minimal message object
    // pointing at the quoted content so downloadMediaMessage can fetch it.
    const ctx = raw.message?.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage) {
      targetMessage = {
        key: { remoteJid: raw.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: ctx.quotedMessage,
      };
    }

    // unwrapMessage handles a voice note sent inside a disappearing-message
    // group (ephemeralMessage) or similar wrappers, same as everywhere else
    // audio is read in this codebase.
    const { inner } = unwrapMessage(targetMessage.message);
    if (!inner?.audioMessage) {
      return msg.reply('Reply to a voice note with /transcribe to get a text transcript.');
    }

    try {
      const transcript = await withTyping(client, chat.id._serialized, async () => {
        const buffer = await downloadMediaMessage(targetMessage, 'buffer', {});
        return transcribeAudio(buffer, inner.audioMessage.mimetype);
      });

      if (!transcript) {
        return msg.reply("⚠️ Couldn't transcribe that voice note - it may be too quiet, too long, or the transcription service is temporarily unavailable.");
      }

      await msg.reply(`📝 Transcript:\n${transcript}`);
    } catch (err) {
      if (isExpectedMediaDownloadFailure(err)) {
        return msg.reply("⚠️ That voice note is no longer available to download (too old, or already expired).");
      }
      logger.warn('/transcribe failed:', err.message);
      await msg.reply('⚠️ Something went wrong trying to transcribe that voice note.');
    }
  },
};
