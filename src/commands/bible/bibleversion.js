const GroupSettings = require('../../models/GroupSettings');
const { listBibles, findBibleTranslation, resolveBibleId } = require('../../utils/bibleApi');
const { NLT_CODES } = require('../../utils/bibleService');
const { BIBLE_TRANSLATION } = require('../../config');
const logger = require('../../utils/logger');

module.exports = {
  name: 'bibleversion',
  aliases: ['bibleversions', 'setbibleversion', 'translation'],
  category: 'bible',
  description: '/bibleversion <code>|list|reset - set translation for Bible replies (e.g. KJV, NIV, NLT, PIDGIN)',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const input = (args[0] || '').trim();

    if (!input) {
      const current = (await GroupSettings.getOrCreate(chat.id._serialized)).bibleVersion || BIBLE_TRANSLATION;
      return chat.sendMessage(
        `📖 This group is currently using *${current}*.\n` +
        'Usage: /bibleversion <code>|list|reset\n' +
        'e.g. /bibleversion KJV, /bibleversion NIV, /bibleversion PIDGIN, /bibleversion list'
      );
    }

    if (input.toLowerCase() === 'reset') {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { bibleVersion: '' }, { upsert: true });
      return chat.sendMessage(`📖 Reset to the default translation (*${BIBLE_TRANSLATION}*).`);
    }

    if (input.toLowerCase() === 'list') {
      let bibles;
      try {
        bibles = await listBibles();
      } catch (err) {
        logger.error('bibleversion list failed:', err.message);
        return chat.sendMessage('⚠️ Could not reach the Bible API just now - try again in a moment.');
      }
      const english = bibles.filter((b) => b.language?.id === 'eng');
      const lines = english.map((b) => `• ${b.abbreviationLocal || b.abbreviation} - ${b.name}`).slice(0, 40);
      const pidgin = bibles.filter((b) =>
        b.language?.id?.toLowerCase() === 'pcm' ||
        /nigerian pidgin|pidgin/i.test(`${b.name || ''} ${b.language?.name || ''}`)
      );
      const pidginLines = pidgin.map((b) => `• ${b.abbreviationLocal || b.abbreviation} - ${b.name}`);
      return chat.sendMessage(
        `📖 *Available translations for this API key:*\n\n${lines.join('\n')}\n\n` +
        (pidginLines.length ? `*Pidgin translations:*\n${pidginLines.join('\n')}\n\n` : '') +
        '• NLT - New Living Translation\n• NLTUK - New Living Translation (UK)\n• NTV - Nueva Traducción Viviente\n(served separately via api.nlt.to)'
      );
    }

    const code = input.toUpperCase();

    // NLT/NLTUK/NTV aren't in api.bible's catalog - they're served
    // separately via api.nlt.to, so they're always valid to set here.
    if (NLT_CODES.has(code)) {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { bibleVersion: code }, { upsert: true });
      return chat.sendMessage(`📖 This group now uses *${code}* for /verse, /versedetect, and the daily verse.`);
    }

    const pidginAlias = ['PIDGIN', 'NPB', 'NPE', 'PCM'].includes(code);
    if (pidginAlias) {
      let bible;
      try {
        bible = findBibleTranslation(code, await listBibles());
      } catch (err) {
        logger.error('bibleversion resolve failed:', err.message);
        return chat.sendMessage('⚠️ Could not reach the Bible API just now - try again in a moment.');
      }

      if (!bible) {
        return chat.sendMessage('⚠️ A Nigerian Pidgin Bible translation is not available to this API key. Check /bibleversion list or enable one in your API.Bible account.');
      }

      const actualCode = bible.abbreviationLocal || bible.abbreviation;
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { bibleVersion: actualCode }, { upsert: true });
      return chat.sendMessage(`📖 This group now uses *${bible.name}* (${actualCode}) for /verse, /versedetect, and the daily verse.`);
    }

    let bibleId;
    try {
      bibleId = await resolveBibleId(code);
    } catch (err) {
      logger.error('bibleversion resolve failed:', err.message);
      return chat.sendMessage('⚠️ Could not reach the Bible API just now - try again in a moment.');
    }

    if (!bibleId) {
      return chat.sendMessage(`⚠️ "${code}" isn't available to this API key. Try /bibleversion list to see what's accessible.`);
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { bibleVersion: code }, { upsert: true });
    return chat.sendMessage(`📖 This group now uses *${code}* for /verse, /versedetect, and the daily verse.`);
  },
};
