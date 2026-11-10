const test = require('node:test');
const assert = require('node:assert/strict');
const { extractRequest, clampMinutes, phoneFromText, vcardDigits } = require('../src/utils/nlCommands');

test('extractRequest reads "BlueHunter ..." requests', () => {
  assert.equal(extractRequest('Bluehunter please change the group name to Fun Zone'), 'change the group name to Fun Zone');
  assert.equal(extractRequest('hey bluehunter, kick this person'), 'kick this person');
  assert.equal(extractRequest('Blue Hunter lock this group for 10 mins'), 'lock this group for 10 mins');
  assert.equal(extractRequest('bluehunter'), null);
  assert.equal(extractRequest('i love the bluehunter bot'), null);
  assert.equal(extractRequest('@2348012345678 approve all', true), 'approve all');
});

test('clampMinutes keeps durations sane', () => {
  assert.equal(clampMinutes(10), 10);
  assert.equal(clampMinutes('15'), 15);
  assert.equal(clampMinutes(0), 0);
  assert.equal(clampMinutes(-5), 0);
  assert.equal(clampMinutes('abc'), 0);
  assert.equal(clampMinutes(999999), 7 * 24 * 60);
});

test('phone numbers and contact cards are read', () => {
  assert.equal(phoneFromText('add +233 50 123 4567 please'), '233501234567');
  assert.equal(phoneFromText('lock for 10 mins'), null);
  assert.equal(vcardDigits('BEGIN:VCARD\nTEL;type=CELL;waid=233501234567:+233 50 123 4567\nEND:VCARD'), '233501234567');
  assert.equal(vcardDigits('BEGIN:VCARD\nTEL;type=CELL:+233 50 123 4567\nEND:VCARD'), '233501234567');
});
