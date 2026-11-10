const { getRandomVerse: getRandomVerseFromApiBible, getBooks, getChapters, getChapterVerseList, resolveBibleId } = require('./bibleApi');
const { getPassageVerses } = require('./nltApi');
const { BIBLE_TRANSLATION, NLT_STRUCTURE_TRANSLATION } = require('../config');
const logger = require('./logger');

const NLT_CODES = new Set(['NLT', 'NLTUK', 'NTV']);

/**
 * Picks a genuinely random verse and returns its NLT (or NLTUK/NTV) text.
 * The NLT API has no "list all books/chapters/verses" endpoint to draw a
 * random pick from, so we borrow api.bible's catalog (via
 * NLT_STRUCTURE_TRANSLATION, a public-domain translation like KJV that's
 * always resolvable) purely to land on a valid book/chapter/verse, then
 * fetch the actual text for that same reference from the NLT API.
 */
async function getRandomNltVerse(version) {
  const structureBibleId = await resolveBibleId(NLT_STRUCTURE_TRANSLATION);
  if (!structureBibleId) {
    logger.warn(`NLT random verse: structure translation "${NLT_STRUCTURE_TRANSLATION}" isn't available to this api.bible key.`);
    return null;
  }
  const books = await getBooks(structureBibleId);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const book = books[Math.floor(Math.random() * books.length)];
      const chapters = await getChapters(structureBibleId, book.id);
      if (!chapters.length) continue;

      const chapter = chapters[Math.floor(Math.random() * chapters.length)];
      const verseList = await getChapterVerseList(structureBibleId, chapter.id);
      if (!verseList.length) continue;

      const verseStub = verseList[Math.floor(Math.random() * verseList.length)];
      const verseNum = verseStub.id.split('.').pop();

      const ref = `${book.name} ${chapter.number}:${verseNum}`;
      const verses = await getPassageVerses(ref, version);
      if (!verses.length) continue;

      return { reference: ref, text: verses[0].text, translation: version };
    } catch (err) {
      logger.warn('NLT random-verse attempt failed, retrying:', err.message);
    }
  }

  return null; // caller should handle gracefully - never block on a bad draw
}

/**
 * Single entry point for /verse and the daily scheduler. Routes NLT-family
 * codes (NLT, NLTUK, NTV) to the NLT API, everything else to api.bible -
 * callers no longer need to know which provider serves which translation.
 */
async function getRandomVerse(translationCode) {
  const code = (translationCode || BIBLE_TRANSLATION || 'NLT').trim().toUpperCase();
  if (NLT_CODES.has(code)) return getRandomNltVerse(code);
  return getRandomVerseFromApiBible(translationCode);
}

module.exports = { getRandomVerse, NLT_CODES };
