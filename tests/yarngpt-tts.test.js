const assert = require('node:assert/strict');
const { test } = require('node:test');

const configPath = require.resolve('../src/config');
const loggerPath = require.resolve('../src/utils/logger');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    OPENAI_API_KEY: 'openai-test-key',
    AI_MODEL: 'test-model',
    YARNGPT_API_KEY: 'yarngpt-test-key',
    YARNGPT_TTS_VOICE: 'Nonso',
  },
};
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { warn() {}, error() {} },
};

const { getTtsAudio } = require('../src/utils/openaiClient');

test('YarnGPT TTS resolves Nonso by display name and streams Opus without sending the API key to the audio URL', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/voices')) {
      return Response.json({ voices: [{ id: 'nonso-current-id', name: 'Nonso' }] });
    }
    if (String(url).endsWith('/tts/prepare')) {
      assert.deepEqual(JSON.parse(options.body), {
        text: 'Good morning, how are you?',
        voice: 'nonso-current-id',
        output_format: 'opus',
      });
      return Response.json({ ticket: 'ticket-123', stream_url: '/api/v1/tts/stream/ticket-123' });
    }
    assert.equal(String(url), 'https://api.yarngpt.ai/api/v1/tts/stream/ticket-123');
    assert.equal(options.headers, undefined);
    return new Response(Buffer.from([0x4f, 0x67, 0x67, 0x53]), {
      headers: { 'Content-Type': 'audio/ogg' },
    });
  };

  try {
    const audio = await getTtsAudio('Good morning, how are you?');
    assert.deepEqual(audio, Buffer.from([0x4f, 0x67, 0x67, 0x53]));
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer yarngpt-test-key');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer yarngpt-test-key');
  } finally {
    global.fetch = originalFetch;
  }
});

test('YarnGPT TTS returns null when voice preparation fails so AI chat can send text instead', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith('/voices')) {
      return Response.json({ voices: [{ id: 'nonso-current-id', name: 'Nonso' }] });
    }
    return new Response('quota unavailable', { status: 402 });
  };

  try {
    assert.equal(await getTtsAudio('A short reply.'), null);
  } finally {
    global.fetch = originalFetch;
  }
});
