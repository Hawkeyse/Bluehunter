const GroupSettings = require('../../models/GroupSettings');

module.exports = {
  name: 'versedetect',
  aliases: ['bibledetect', 'autoverse', 'versemode'],
  category: 'bible',
  description: '/versedetect on|off - automatically reply with the real verse when someone types a reference like "Psalm 121" or "John 3:16"',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const input = (args[0] || '').toLowerCase();

    if (input === 'off') {
      await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { bibleVerseDetectEnabled: false }, { upsert: true });
      return chat.sendMessage('📖 Bible verse detection is now DISABLED.');
    }

    if (input !== 'on') {
      return chat.sendMessage(
        'Usage: /versedetect on|off\n' +
        'When ON (the default), a reference like "Psalm 121", "Genesis 1", "John 3:16" or "1 Corinthians 13:4-7" gets an automatic reply. A book and chapter without a verse returns verse 1.\n' +
        'This is separate from /bible (the once-a-day scheduled verse).'
      );
    }

    await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { bibleVerseDetectEnabled: true }, { upsert: true });
    return chat.sendMessage('📖 Bible verse detection is now ENABLED - drop a reference like "Psalm 121", "Genesis 1" or "John 3:16" anywhere in chat. Book + chapter returns verse 1.');
  },
};
