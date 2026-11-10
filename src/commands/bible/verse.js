const { getRandomVerse } = require('../../utils/bibleService');
const { getAiReply } = require('../../utils/openaiClient');
const GroupSettings = require('../../models/GroupSettings');
const logger = require('../../utils/logger');

const REFLECTION_SYSTEM_PROMPT = `Write one brief, thoughtful reflection (one sentence, at most 25 words) to accompany a Bible verse in a WhatsApp chat. Make it meaningful, gently encouraging, and grounded in the verse's actual message; offer hope without promising that every problem will disappear. Do not alter, repeat, paraphrase, or "correct" the verse, and do not invent other scripture. No greeting or sign-off - only the reflection.`;

module.exports = {
  name: 'verse',
  aliases: ['randomverse', 'bibleverse'],
  category: 'bible',
  description: '/verse - get a random Bible verse with a brief, thoughtful encouragement',
  async execute({ msg, chat }) {
    const translationCode = chat.isGroup ? (await GroupSettings.getOrCreate(chat.id._serialized)).bibleVersion : '';

    let verse;
    try {
      verse = await getRandomVerse(translationCode);
    } catch (err) {
      logger.error('verse fetch failed:', err.message);
      return msg.reply("⚠️ Couldn't reach the Bible API just now - try again in a moment.");
    }
    if (!verse) {
      return msg.reply("⚠️ Couldn't reach the Bible API just now - try again in a moment.");
    }

    let text = `*${verse.reference}* (${verse.translation})\n${verse.text}`;

    try {
      const reflection = await getAiReply(REFLECTION_SYSTEM_PROMPT, `Reference: ${verse.reference}\nText: "${verse.text}"`);
      if (reflection) text += `\n\n${reflection}`;
    } catch (err) {
      logger.warn('verse reflection failed:', err.message); // verse itself still sends without it
    }

    await msg.reply(text);
  },
};
