const assert = require('node:assert/strict');
const { test } = require('node:test');

const { applyModerationAction } = require('../src/utils/moderationAction');
const { maybeHandleModerationApology } = require('../src/utils/moderationApology');
const { maybeRagebait, classifyTrigger } = require('../src/utils/ragebait');
const { buildSystemPrompt } = require('../src/utils/aiPersonality');

test('a moderated member apology gets a calm acknowledgment, independent of AI chat', async () => {
  const groupId = 'apology-test@g.us';
  const senderId = 'member@lid';
  const notices = [];
  const chat = {
    isGroup: true,
    id: { _serialized: groupId },
    async sendMessage(text, options) {
      notices.push({ text, options });
    },
  };
  const msg = {
    body: 'Bad link',
    _raw: { key: { participant: senderId } },
    async delete() { return true; },
  };

  await applyModerationAction({
    action: 'delete',
    chat,
    msg,
    senderId,
    reason: 'links are not allowed here.',
  });

  const apology = { body: 'ok sry', _raw: { key: { participant: senderId } } };
  assert.equal(await maybeHandleModerationApology({ chat, msg: apology, senderId }), true);
  assert.equal(notices[1].text, "It's okay — just don't do it again, please.");
  assert.deepEqual(notices[1].options.mentions, [senderId]);
  assert.equal(await maybeHandleModerationApology({ chat, msg: apology, senderId }), false);
});

test('Destro gets a reaction-only explosion, even when normal ragebait is disabled', async () => {
  assert.equal(classifyTrigger('Destro').type, 'destro');
  const sent = [];
  const waMessage = { key: { id: 'destro-1' } };
  const handled = await maybeRagebait({
    sock: { async sendMessage(...args) { sent.push(args); } },
    waMessage,
    chat: { isGroup: true, id: { _serialized: 'destro-test@g.us' } },
    msg: { body: 'Destro' },
    senderId: 'player@s.whatsapp.net',
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [[
    'destro-test@g.us',
    { react: { text: '💥', key: waMessage.key } },
  ]]);
});

test('passive ragebait does not reply to ordinary group chatter', async () => {
  const sent = [];
  const handled = await maybeRagebait({
    sock: { async sendMessage(...args) { sent.push(args); } },
    waMessage: { key: { id: 'who-1' }, message: { conversation: 'Who?' } },
    chat: { isGroup: true, id: { _serialized: 'quiet-chat-test@g.us' } },
    msg: { body: 'Who?' },
    senderId: 'player@s.whatsapp.net',
  });

  assert.equal(handled, false);
  assert.equal(sent.length, 0);
});

test('AI prompt stays selective and uses game-specific context for Clash of Clans', () => {
  const prompt = buildSystemPrompt({
    isOwnerMessage: false,
    isGroupAdmin: false,
    addressed: true,
    replyingToBot: false,
    commandReference: '',
    stickersAvailable: false,
    voiceAvailable: false,
    roastTargetLabel: null,
    recentBotReplies: [],
  });

  assert.match(prompt, /Do not jump into ordinary group conversation or reply to every message/);
  assert.match(prompt, /Clash of Clans/);
  assert.match(prompt, /game strategy, not real-world violence/);
});
