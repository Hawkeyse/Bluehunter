const fs = require('fs');
const { findWarnings } = require('../../utils/warnStore');
const { getTargetUser } = require('../../utils/mentions');

module.exports = {
  name: 'aicases',
  category: 'moderation',
  description: "/aicases @user - review a user's AI-moderation strikes, with evidence",
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat, client }) {
    const target = await getTargetUser(msg);
    if (!target) return msg.reply('Tag or reply to the user whose AI-moderation cases you want to review.');

    const cases = await findWarnings(chat.id._serialized, target, { source: 'ai', sortDir: 1 });
    if (cases.length === 0) {
      return chat.sendMessage(`✅ No AI-moderation strikes on record for @${target.split('@')[0]}.`, { mentions: [target] });
    }

    await chat.sendMessage(`🤖 AI-moderation cases for @${target.split('@')[0]} (${cases.length}):`, { mentions: [target] });

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const header = `Case ${i + 1} - ${c.createdAt.toLocaleString()}\nReason: ${c.reason}`;

      if (['text', 'voice', 'document'].includes(c.evidenceType)) {
        const label = c.evidenceType === 'text' ? 'Flagged text' : c.evidenceType === 'voice' ? 'Transcript' : 'Details';
        await chat.sendMessage(`${header}\n${label}: "${c.evidenceText}"`);
        continue;
      }

      if (c.evidencePath && fs.existsSync(c.evidencePath)) {
        try {
          const buffer = fs.readFileSync(c.evidencePath);
          // Evidence is always resent as a still image - video evidence is only
          // ever a JPEG thumbnail to begin with, and stickers are sent as their
          // raw webp bytes, which WhatsApp still displays fine as an image.
          await client.sendMessage(chat.id._serialized, { image: buffer, caption: header });
        } catch (err) {
          await chat.sendMessage(`${header}\n(Evidence file exists but couldn't be read.)`);
        }
      } else {
        await chat.sendMessage(`${header}\n(No evidence file saved for this case.)`);
      }
    }
  },
};