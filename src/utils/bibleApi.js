const { fetchWithTimeout } = require('./http');
const { BIBLE_API_BASE, BIBLE_API_KEY, BIBLE_TRANSLATION } = require('../config');
const logger = require('./logger');

function requireKey() {
  if (!BIBLE_API_KEY) throw new Error('BIBLE_API_KEY is not set in .env');
}

async function apiGet(path, params = {}) {
  requireKey();
  const qs = new URLSearchParams(params).toString();
  const res = await fetchWithTimeout(`${BIBLE_API_BASE}${path}${qs ? `?${qs}` : ''}`, {
    headers: { 'api-key': BIBLE_API_KEY },
  });
  if (!res.ok) throw new Error(`Bible API ${res.status} for ${path}`);
  const json = await res.json();
  return json.data;
}

// Cached in memory (process lifetime) - the catalog of Bibles your key has
// access to doesn't change mid-run, and this is looked up on basically every
// verse request (to resolve a translation code -> bibleId).
let biblesCache = null;
const PIDGIN_TRANSLATION_CODES = new Set(['PIDGIN', 'NPB', 'NPE', 'PCM']);

/** Full catalog of Bibles available to this API key (all languages). */
async function listBibles() {
  if (biblesCache) return biblesCache;
  biblesCache = await apiGet('/bibles');
  return biblesCache;
}

/**
 * Resolves a translation code (e.g. "NLT", "KJV", "NIV", "ESV") to the
 * api.bible bibleId needed for every other call. Matches against
 * abbreviationLocal/abbreviation (case-insensitive), restricted to English
 * unless the code itself suggests otherwise. Returns null if your API
 * key/plan doesn't have that translation - use /bibleversion list to see
 * what's actually available.
 */
function findBibleTranslation(translationCode, bibles) {
  const code = (translationCode || BIBLE_TRANSLATION || '').trim().toUpperCase();
  if (!code) return null;

  if (PIDGIN_TRANSLATION_CODES.has(code)) {
    return bibles.find((b) =>
      b.language?.id?.toLowerCase() === 'pcm' ||
      /nigerian pidgin|pidgin/i.test(`${b.name || ''} ${b.language?.name || ''}`)
    ) || null;
  }

  return (
    bibles.find((b) => b.language?.id === 'eng' && (b.abbreviationLocal === code || b.abbreviation === code)) ||
    bibles.find((b) => (b.abbreviationLocal || '').toUpperCase() === code || (b.abbreviation || '').toUpperCase() === code)
  ) || null;
}

async function resolveBibleId(translationCode) {
  const bibles = await listBibles();
  const match = findBibleTranslation(translationCode, bibles);

  return match ? match.id : null;
}

// Books cache per bibleId - the book list for a given Bible never changes.
const booksCacheByBible = new Map();

/** List of books for a bibleId, e.g. [{ id: 'GEN', name: 'Genesis' }, ...] */
async function getBooks(bibleId) {
  if (booksCacheByBible.has(bibleId)) return booksCacheByBible.get(bibleId);
  const books = await apiGet(`/bibles/${bibleId}/books`);
  booksCacheByBible.set(bibleId, books);
  return books;
}

/** Chapter list for one book, e.g. [{ id: 'GEN.1', number: '1' }, ...] (includes an "intro" entry to filter out). */
async function getChapters(bibleId, bookId) {
  const chapters = await apiGet(`/bibles/${bibleId}/books/${bookId}/chapters`);
  return chapters.filter((c) => c.number && /^\d+$/.test(c.number));
}

/** Verse stubs (id + reference, no text) for one chapter - used to pick a random verse or validate a range. */
async function getChapterVerseList(bibleId, chapterId) {
  return apiGet(`/bibles/${bibleId}/chapters/${chapterId}/verses`);
}

const TEXT_PARAMS = {
  'content-type': 'text',
  'include-notes': 'false',
  'include-titles': 'false',
  'include-chapter-numbers': 'false',
  'include-verse-numbers': 'false',
};

/** Plain text (no HTML, no verse-number clutter) for a single verseId, e.g. "JHN.3.16". */
async function getVerseText(bibleId, verseId) {
  const data = await apiGet(`/bibles/${bibleId}/verses/${verseId}`, TEXT_PARAMS);
  return (data.content || '').trim();
}

/** Plain text for a verse range, e.g. passageId "JHN.3.16-JHN.3.17". */
async function getPassageText(bibleId, passageId) {
  const data = await apiGet(`/bibles/${bibleId}/passages/${passageId}`, TEXT_PARAMS);
  return (data.content || '').trim();
}

/**
 * Picks a real, random verse from the given translation. Retries a handful
 * of times on transient failures (rare book/chapter with no verse list etc.)
 * instead of ever blocking a /verse call or the daily scheduler on one bad draw.
 */
async function getRandomVerse(translationCode) {
  const bibleId = await resolveBibleId(translationCode || BIBLE_TRANSLATION);
  if (!bibleId) {
    logger.warn(`Bible translation "${translationCode || BIBLE_TRANSLATION}" not found/available for this API key.`);
    return null;
  }

  const books = await getBooks(bibleId);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const book = books[Math.floor(Math.random() * books.length)];
      const chapters = await getChapters(bibleId, book.id);
      if (!chapters.length) continue;

      const chapter = chapters[Math.floor(Math.random() * chapters.length)];
      const verses = await getChapterVerseList(bibleId, chapter.id);
      if (!verses.length) continue;

      const verseStub = verses[Math.floor(Math.random() * verses.length)];
      const text = await getVerseText(bibleId, verseStub.id);
      if (!text) continue;

      return {
        reference: verseStub.reference || `${book.name} ${chapter.number}`,
        text,
        translation: translationCode || BIBLE_TRANSLATION,
      };
    } catch (err) {
      logger.warn('Bible API random-verse attempt failed, retrying:', err.message);
    }
  }

  return null; // caller should handle gracefully - never block on a bad draw
}

module.exports = {
  listBibles,
  findBibleTranslation,
  resolveBibleId,
  getBooks,
  getChapters,
  getChapterVerseList,
  getVerseText,
  getPassageText,
  getRandomVerse,
};
