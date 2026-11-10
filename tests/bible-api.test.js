const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findBibleTranslation } = require('../src/utils/bibleApi');

const translations = [
  { id: 'nlt-id', abbreviation: 'NLT', abbreviationLocal: 'NLT', name: 'New Living Translation', language: { id: 'eng', name: 'English' } },
  { id: 'pidgin-id', abbreviation: 'NPB', abbreviationLocal: 'NPB', name: 'Nigerian Pidgin Bible', language: { id: 'pcm', name: 'Nigerian Pidgin' } },
];

test('resolves Nigerian Pidgin aliases to an available Pidgin Bible', () => {
  for (const alias of ['PIDGIN', 'NPB', 'NPE', 'PCM']) {
    assert.equal(findBibleTranslation(alias, translations), translations[1]);
  }
});

test('does not silently select an English Bible when Pidgin is unavailable', () => {
  assert.equal(findBibleTranslation('PIDGIN', [translations[0]]), null);
});

test('continues resolving regular translation codes', () => {
  assert.equal(findBibleTranslation('NLT', translations), translations[0]);
});
