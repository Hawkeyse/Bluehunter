const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reserveAiChatAttempt } = require('../src/utils/aiChatLimiter');

test('AI chat enforces group cooldowns and a per-sender cooldown', () => {
  const start = 1_000_000;
  assert.equal(reserveAiChatAttempt('group-cooldown', 'alice', start), true);
  assert.equal(reserveAiChatAttempt('group-cooldown', 'bob', start + 59_999), false);
  assert.equal(reserveAiChatAttempt('group-cooldown', 'bob', start + 60_000), true);
  assert.equal(reserveAiChatAttempt('group-cooldown', 'alice', start + 3 * 60_000), true);
});

test('AI chat enforces a minimum one-minute group cooldown', () => {
  const start = 2_000_000;
  assert.equal(reserveAiChatAttempt('minimum-cooldown', 'alice', start, 1_000), true);
  assert.equal(reserveAiChatAttempt('minimum-cooldown', 'bob', start + 59_999, 1_000), false);
  assert.equal(reserveAiChatAttempt('minimum-cooldown', 'bob', start + 60_000, 1_000), true);
});

test('AI chat caps attempts per group within a rolling hour', () => {
  const start = 3_000_000;
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.equal(reserveAiChatAttempt('hourly-cap', `sender-${attempt}`, start + attempt * 60_000, 60_000), true);
  }
  assert.equal(reserveAiChatAttempt('hourly-cap', 'sender-20', start + 20 * 60_000, 60_000), false);
  assert.equal(reserveAiChatAttempt('hourly-cap', 'sender-21', start + 60 * 60_000, 60_000), true);
});
