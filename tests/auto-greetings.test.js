const assert = require('node:assert/strict');
const { test } = require('node:test');

const openAiClientPath = require.resolve('../src/utils/openaiClient');
let generatedBody = null;
let capturedPrompt = '';
require.cache[openAiClientPath] = {
  id: openAiClientPath,
  filename: openAiClientPath,
  loaded: true,
  exports: {
    getAiReply: async (systemPrompt) => {
      capturedPrompt = systemPrompt;
      return generatedBody;
    },
  },
};

const { buildGreetingText } = require('../src/utils/autoGreetingScheduler');
const morning = { key: 'morning', header: 'Good morning', emoji: '☀️' };

test('builds Nigerian Pidgin greeting with a localized greeting header and fallback', async () => {
  generatedBody = null;
  const text = await buildGreetingText(morning, 'Lagos Community', 'pidgin');

  assert.match(text, /^Una good morning o! ☀️/);
  assert.match(text, /Lagos Community/);
  assert.match(text, /Una don wake/);
  assert.match(capturedPrompt, /Nigerian Pidgin/);
  assert.match(capturedPrompt, /sometimes funny and light/);
  assert.match(capturedPrompt, /sometimes a short prayer or blessing/);
});

test('uses the generated Pidgin greeting body when available', async () => {
  generatedBody = 'Omo, make today bring better gist and soft landing. 🙏🏾';
  const text = await buildGreetingText(morning, 'Lagos Community', 'pidgin');

  assert.match(text, /Omo, make today bring better gist/);
  assert.doesNotMatch(text, /Una don wake/);
});

test('keeps English as the default greeting language', async () => {
  generatedBody = null;
  const text = await buildGreetingText(morning, 'Lagos Community');

  assert.match(text, /^Good morning! ☀️/);
  assert.match(text, /Hope you're all doing well/);
  assert.match(capturedPrompt, /English/);
});
