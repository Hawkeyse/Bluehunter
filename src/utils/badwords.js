const Filter = require('bad-words');

const filter = new Filter();

// Add any extra words/phrases specific to your community here:
// filter.addWords('someword', 'anotherword');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Checks the built-in profanity list first, then each group's own custom
// word/phrase list (managed via /badword add|remove|list). Custom entries
// match as whole words/phrases, case-insensitive.
function containsBadWords(text, customWords = []) {
  if (!text) return false;
  if (filter.isProfane(text)) return true;

  for (const raw of customWords) {
    const word = (raw || '').toLowerCase().trim();
    if (!word) continue;
    if (new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(text)) return true;
  }

  return false;
}

module.exports = { containsBadWords };
