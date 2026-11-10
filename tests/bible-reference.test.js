const assert = require('node:assert/strict');
const { test } = require('node:test');

const bibleApiPath = require.resolve('../src/utils/bibleApi');
const nltApiPath = require.resolve('../src/utils/nltApi');
const bibleServicePath = require.resolve('../src/utils/bibleService');
const calls = [];

require.cache[bibleApiPath] = {
  id: bibleApiPath,
  filename: bibleApiPath,
  loaded: true,
  exports: {
    resolveBibleId: async () => 'test-bible',
    getVerseText: async () => 'A verse.',
  },
};
require.cache[nltApiPath] = {
  id: nltApiPath,
  filename: nltApiPath,
  loaded: true,
  exports: {
    getPassageVerses: async (reference, version) => {
      calls.push({ reference, version });
      if (/:\d+$/.test(reference)) {
        return [{ number: 1, text: 'I lift my eyes toward the mountains.' }];
      }
      return [
        { number: 1, text: 'I lift my eyes toward the mountains.' },
        { number: 2, text: 'My help comes from the Lord.' },
      ];
    },
  },
};
require.cache[bibleServicePath] = {
  id: bibleServicePath,
  filename: bibleServicePath,
  loaded: true,
  exports: { NLT_CODES: new Set(['NLT', 'NLTUK', 'NTV']) },
};

const { extractReferences, fetchReferenceText } = require('../src/utils/bibleReference');
const { maybeHandleBibleReference } = require('../src/utils/bibleVerseDetector');
const GroupSettings = require('../src/models/GroupSettings');

test('detects whole-chapter references and existing verse references', () => {
  const chapter = extractReferences('Please post Psalm 121?');
  assert.equal(chapter.length, 1);
  assert.equal(chapter[0].book.name, 'Psalm');
  assert.equal(chapter[0].chapter, 121);
  assert.equal(chapter[0].verseStart, 1);

  const verse = extractReferences('1 Corinthians 13:4-7');
  assert.equal(verse.length, 1);
  assert.equal(verse[0].book.name, '1 Corinthians');
  assert.equal(verse[0].verseStart, 4);
  assert.equal(verse[0].verseEnd, 7);

  assert.deepEqual(extractReferences('I read 121 pages today.'), []);
});

test('uses NLT to fetch verse 1 when the message only names a book and chapter', async () => {
  calls.length = 0;
  const [reference] = extractReferences('Psalm 121');
  const result = await fetchReferenceText(reference, 'NLT');

  assert.deepEqual(calls, [{ reference: 'Psalm 121:1', version: 'NLT' }]);
  assert.equal(result.reference, 'Psalm 121:1');
  assert.equal(result.translation, 'NLT');
  assert.equal(result.text, 'I lift my eyes toward the mountains.');
});

test('does not post a random verse for a generic Bible verse request', async () => {
  const handled = await maybeHandleBibleReference({
    msg: { body: 'Bible verse please', reply: async () => assert.fail('should not reply without a reference') },
    translationCode: '',
  });

  assert.equal(handled, false);
});

test('posts only verse 1 for Psalm 121 and Genesis 1 references', async () => {
  let reply;
  let handled = await maybeHandleBibleReference({
    msg: { body: 'Please share Psalm 121', reply: async (text) => { reply = text; } },
    translationCode: 'NLT',
  });

  assert.equal(handled, true);
  assert.equal(reply, '*Psalm 121:1* (NLT)\nI lift my eyes toward the mountains.');

  handled = await maybeHandleBibleReference({
    msg: { body: 'Genesis 1', reply: async (text) => { reply = text; } },
    translationCode: 'NLT',
  });
  assert.equal(handled, true);
  assert.equal(reply, '*Genesis 1:1* (NLT)\nI lift my eyes toward the mountains.');
});

test('enables automatic verse detection by default', () => {
  assert.equal(GroupSettings.schema.path('bibleVerseDetectEnabled').defaultValue, true);
});
