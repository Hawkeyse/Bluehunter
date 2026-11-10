const test = require('node:test');
const assert = require('node:assert/strict');
const { isComplaintText, isNegativeReaction } = require('../src/utils/crowdModeration');

test('short complaints are recognised', () => {
  for (const t of ['wtf', 'WTF bro', 'what the hell', 'that is not funny', 'not funny at all', 'this is sick', 'delete that', 'e no funny', 'wetin be this']) {
    assert.equal(isComplaintText(t), true, t);
  }
});

test('normal chat is not a complaint', () => {
  for (const t of ['good morning everyone', 'lol that was funny', 'who is coming tonight?', '', 'a'.repeat(200) + ' wtf']) {
    assert.equal(isComplaintText(t), false, t);
  }
});

test('only negative emojis count as reactions', () => {
  assert.equal(isNegativeReaction('🤮'), true);
  assert.equal(isNegativeReaction('😡'), true);
  assert.equal(isNegativeReaction('👍'), false);
  assert.equal(isNegativeReaction('😂'), false);
  assert.equal(isNegativeReaction(''), false);
});
