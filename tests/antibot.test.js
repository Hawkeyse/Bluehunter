const test = require('node:test');
const assert = require('node:assert/strict');
const { isLikelyBotMessage } = require('../src/utils/antibot');

const msg = (id, extra = {}) => ({ key: { id, fromMe: false }, message: { conversation: 'hi' }, ...extra });

test('flags Baileys default and legacy IDs and custom-prefix IDs', () => {
  assert.equal(isLikelyBotMessage(msg('3EB0' + 'A1'.repeat(18))), true);
  assert.equal(isLikelyBotMessage(msg('BAE5' + 'F0'.repeat(8))), true);
  assert.equal(isLikelyBotMessage(msg('NJX-1A2B3C4D5E')), true);
});

test('does not flag normal app or WhatsApp Web IDs', () => {
  assert.equal(isLikelyBotMessage(msg('A1B2C3D4E5F60718293A4B5C6D7E8F90')), false); // 32-hex phone id
  assert.equal(isLikelyBotMessage(msg('3EB0A1B2C3D4E5F60718')), false); // web id
});

test('ignores own, reaction and protocol messages', () => {
  const id = '3EB0' + 'A1'.repeat(18);
  assert.equal(isLikelyBotMessage({ key: { id, fromMe: true }, message: { conversation: 'x' } }), false);
  assert.equal(isLikelyBotMessage({ key: { id }, message: { reactionMessage: {} } }), false);
  assert.equal(isLikelyBotMessage({ key: { id }, message: { protocolMessage: {} } }), false);
});
