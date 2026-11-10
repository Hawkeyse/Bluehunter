const assert = require('node:assert/strict');
const { before, test } = require('node:test');

process.env.OPENAI_API_KEY = 'test-key';
const openAiClientPath = require.resolve('../src/utils/openaiClient');
require.cache[openAiClientPath] = {
  id: openAiClientPath,
  filename: openAiClientPath,
  loaded: true,
  exports: {
    getAiReply: async (_systemPrompt, userText) => {
      assert.match(userText, /Respond to this latest message: wtf\?!/i);
      return 'That plot twist needs its own warning label.';
    },
  },
};

const { maybeRagebait, classifyTrigger } = require('../src/utils/ragebait');

before(() => {
  assert.equal(classifyTrigger('WTF?!').type, 'wtf');
  assert.equal(classifyTrigger('Who?').type, 'who');
  assert.equal(classifyTrigger('what happened here?').type, 'what_happened');
  assert.equal(classifyTrigger('wetin dey happen?').type, 'what_happened');
  assert.equal(classifyTrigger('Is this a bot?').type, 'is_bot');
  assert.equal(classifyTrigger('just checking in'), null);
  assert.ok(classifyTrigger('I quit').fallbacks.includes('Oya dey go now.'));
  assert.ok(classifyTrigger('Nobody cares').fallbacks.includes('Leave him neck; the jokes are still loading.'));
  assert.ok(classifyTrigger('what happened here?').fallbacks.includes('As how na? The plot don thick.'));
});

test('WTF reacts to the original message and sends a contextual AI reply', async () => {
  const sent = [];
  const waMessage = { key: { id: 'message-1' } };
  const sock = {
    async sendMessage(...args) {
      sent.push(args);
    },
  };
  const handled = await maybeRagebait({
    sock,
    waMessage,
    chat: { isGroup: true, id: { _serialized: 'ragebait-test-group' } },
    msg: { body: 'WTF?!' },
    senderId: 'test-sender',
  });

  assert.equal(handled, true);
  assert.deepEqual(sent[0][1], { react: { text: '💀', key: waMessage.key } });
  assert.equal(sent[1][1].text, 'That plot twist needs its own warning label.');
  assert.equal(sent[1][2].quoted, waMessage);
});

test('WTF reaction still happens when the reply cooldown is active', async () => {
  const sent = [];
  const waMessage = { key: { id: 'message-2' } };
  const sock = {
    async sendMessage(...args) {
      sent.push(args);
    },
  };
  await maybeRagebait({
    sock,
    waMessage,
    chat: { isGroup: true, id: { _serialized: 'ragebait-test-group' } },
    msg: { body: 'WTH?' },
    senderId: 'another-sender',
  });

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][1], { react: { text: '💀', key: waMessage.key } });
});
