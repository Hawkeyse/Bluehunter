const { resolveBibleId, getVerseText } = require('./bibleApi');
const { getPassageVerses } = require('./nltApi');
const { BIBLE_TRANSLATION } = require('../config');
const { NLT_CODES } = require('./bibleService');

// USFM-style book IDs (used by the Bible API regardless of translation) with
// common name/abbreviation aliases people actually type in chat. Aliases are
// matched after normalization (lowercased, numbers/ordinals folded down to
// "1"/"2"/"3", periods stripped, spaces collapsed) - see normalizeQuery().
const BOOKS = [
  { id: 'GEN', name: 'Genesis', aliases: ['genesis', 'gen', 'ge', 'gn'] },
  { id: 'EXO', name: 'Exodus', aliases: ['exodus', 'exo', 'ex'] },
  { id: 'LEV', name: 'Leviticus', aliases: ['leviticus', 'lev', 'le', 'lv'] },
  { id: 'NUM', name: 'Numbers', aliases: ['numbers', 'num', 'nu', 'nm'] },
  { id: 'DEU', name: 'Deuteronomy', aliases: ['deuteronomy', 'deut', 'deu', 'dt'] },
  { id: 'JOS', name: 'Joshua', aliases: ['joshua', 'josh', 'jos'] },
  { id: 'JDG', name: 'Judges', aliases: ['judges', 'judg', 'jdg', 'jgs'] },
  { id: 'RUT', name: 'Ruth', aliases: ['ruth', 'rut', 'ru'] },
  { id: '1SA', name: '1 Samuel', aliases: ['1 samuel', '1samuel', '1 sam', '1sam', '1 sa', '1sa'] },
  { id: '2SA', name: '2 Samuel', aliases: ['2 samuel', '2samuel', '2 sam', '2sam', '2 sa', '2sa'] },
  { id: '1KI', name: '1 Kings', aliases: ['1 kings', '1kings', '1 kgs', '1kgs', '1 ki', '1ki'] },
  { id: '2KI', name: '2 Kings', aliases: ['2 kings', '2kings', '2 kgs', '2kgs', '2 ki', '2ki'] },
  { id: '1CH', name: '1 Chronicles', aliases: ['1 chronicles', '1chronicles', '1 chron', '1chron', '1 ch', '1ch'] },
  { id: '2CH', name: '2 Chronicles', aliases: ['2 chronicles', '2chronicles', '2 chron', '2chron', '2 ch', '2ch'] },
  { id: 'EZR', name: 'Ezra', aliases: ['ezra', 'ezr'] },
  { id: 'NEH', name: 'Nehemiah', aliases: ['nehemiah', 'neh'] },
  { id: 'EST', name: 'Esther', aliases: ['esther', 'esth', 'est'] },
  { id: 'JOB', name: 'Job', aliases: ['job', 'jb'] },
  { id: 'PSA', name: 'Psalm', aliases: ['psalms', 'psalm', 'ps', 'psa', 'pslm'] },
  { id: 'PRO', name: 'Proverbs', aliases: ['proverbs', 'prov', 'pro', 'prv'] },
  { id: 'ECC', name: 'Ecclesiastes', aliases: ['ecclesiastes', 'eccl', 'ecc', 'qoh'] },
  { id: 'SNG', name: 'Song of Solomon', aliases: ['song of solomon', 'song of songs', 'canticles', 'sos', 'song'] },
  { id: 'ISA', name: 'Isaiah', aliases: ['isaiah', 'isa', 'is'] },
  { id: 'JER', name: 'Jeremiah', aliases: ['jeremiah', 'jer'] },
  { id: 'LAM', name: 'Lamentations', aliases: ['lamentations', 'lam'] },
  { id: 'EZK', name: 'Ezekiel', aliases: ['ezekiel', 'ezek', 'eze'] },
  { id: 'DAN', name: 'Daniel', aliases: ['daniel', 'dan', 'dn'] },
  { id: 'HOS', name: 'Hosea', aliases: ['hosea', 'hos'] },
  { id: 'JOL', name: 'Joel', aliases: ['joel', 'jol', 'jl'] },
  { id: 'AMO', name: 'Amos', aliases: ['amos', 'amo', 'am'] },
  { id: 'OBA', name: 'Obadiah', aliases: ['obadiah', 'obad', 'oba', 'ob'] },
  { id: 'JON', name: 'Jonah', aliases: ['jonah', 'jnh', 'jon'] },
  { id: 'MIC', name: 'Micah', aliases: ['micah', 'mic'] },
  { id: 'NAM', name: 'Nahum', aliases: ['nahum', 'nam', 'nah'] },
  { id: 'HAB', name: 'Habakkuk', aliases: ['habakkuk', 'hab'] },
  { id: 'ZEP', name: 'Zephaniah', aliases: ['zephaniah', 'zeph', 'zep'] },
  { id: 'HAG', name: 'Haggai', aliases: ['haggai', 'hag'] },
  { id: 'ZEC', name: 'Zechariah', aliases: ['zechariah', 'zech', 'zec'] },
  { id: 'MAL', name: 'Malachi', aliases: ['malachi', 'mal'] },
  { id: 'MAT', name: 'Matthew', aliases: ['matthew', 'matt', 'mat', 'mt'] },
  { id: 'MRK', name: 'Mark', aliases: ['mark', 'mrk', 'mk'] },
  { id: 'LUK', name: 'Luke', aliases: ['luke', 'luk', 'lk'] },
  { id: 'JHN', name: 'John', aliases: ['john', 'jhn', 'jn'] },
  { id: 'ACT', name: 'Acts', aliases: ['acts', 'act', 'ac'] },
  { id: 'ROM', name: 'Romans', aliases: ['romans', 'rom', 'ro'] },
  { id: '1CO', name: '1 Corinthians', aliases: ['1 corinthians', '1corinthians', '1 cor', '1cor', '1 co', '1co'] },
  { id: '2CO', name: '2 Corinthians', aliases: ['2 corinthians', '2corinthians', '2 cor', '2cor', '2 co', '2co'] },
  { id: 'GAL', name: 'Galatians', aliases: ['galatians', 'gal'] },
  { id: 'EPH', name: 'Ephesians', aliases: ['ephesians', 'eph'] },
  { id: 'PHP', name: 'Philippians', aliases: ['philippians', 'phil', 'php'] },
  { id: 'COL', name: 'Colossians', aliases: ['colossians', 'col'] },
  { id: '1TH', name: '1 Thessalonians', aliases: ['1 thessalonians', '1thessalonians', '1 thess', '1thess', '1 th', '1th'] },
  { id: '2TH', name: '2 Thessalonians', aliases: ['2 thessalonians', '2thessalonians', '2 thess', '2thess', '2 th', '2th'] },
  { id: '1TI', name: '1 Timothy', aliases: ['1 timothy', '1timothy', '1 tim', '1tim', '1 ti', '1ti'] },
  { id: '2TI', name: '2 Timothy', aliases: ['2 timothy', '2timothy', '2 tim', '2tim', '2 ti', '2ti'] },
  { id: 'TIT', name: 'Titus', aliases: ['titus', 'tit'] },
  { id: 'PHM', name: 'Philemon', aliases: ['philemon', 'philem', 'phm'] },
  { id: 'HEB', name: 'Hebrews', aliases: ['hebrews', 'heb'] },
  { id: 'JAS', name: 'James', aliases: ['james', 'jas', 'jam'] },
  { id: '1PE', name: '1 Peter', aliases: ['1 peter', '1peter', '1 pet', '1pet', '1 pe', '1pe'] },
  { id: '2PE', name: '2 Peter', aliases: ['2 peter', '2peter', '2 pet', '2pet', '2 pe', '2pe'] },
  { id: '1JN', name: '1 John', aliases: ['1 john', '1john', '1 jn', '1jn', '1 jhn', '1jhn'] },
  { id: '2JN', name: '2 John', aliases: ['2 john', '2john', '2 jn', '2jn', '2 jhn', '2jhn'] },
  { id: '3JN', name: '3 John', aliases: ['3 john', '3john', '3 jn', '3jn', '3 jhn', '3jhn'] },
  { id: 'JUD', name: 'Jude', aliases: ['jude', 'jud'] },
  { id: 'REV', name: 'Revelation', aliases: ['revelation', 'revelations', 'rev', 're'] },
];

const ALIAS_TO_BOOK = new Map();
for (const book of BOOKS) {
  for (const alias of book.aliases) ALIAS_TO_BOOK.set(alias, book);
}

/** Lowercases, folds ordinal prefixes ("First"/"1st"/"I ") down to "1 ", strips periods, collapses whitespace. */
function normalizeQuery(raw) {
  let s = raw.toLowerCase().replace(/\./g, '').trim().replace(/\s+/g, ' ');
  s = s.replace(/^(first|1st|i)\s+/, '1 ');
  s = s.replace(/^(second|2nd|ii)\s+/, '2 ');
  s = s.replace(/^(third|3rd|iii)\s+/, '3 ');
  return s;
}

function resolveBook(raw) {
  const normalized = normalizeQuery(raw);
  return ALIAS_TO_BOOK.get(normalized) || ALIAS_TO_BOOK.get(normalized.replace(/\s+/g, '')) || null;
}

// Matches a trailing "<chapter>:<verse>[-<verse>]" - the book name itself is
// resolved separately by walking backward from this match (see
// extractReferences), since book names can be 1-3 words ("John", "Song of
// Solomon", "1 Corinthians").
const CHAPTER_VERSE_RE = /(\d{1,3})\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?/g;
const CHAPTER_ONLY_RE = /\b(\d{1,3})\b/g;

/**
 * Scans free text for Bible references (e.g. "Psalm 121", "John 3:16",
 * "1 Corinthians 13:4-7"). It resolves nearby book names against the book
 * catalog so ordinary numbers and scores are not treated as references.
 * Returns at most 3 references per message to keep replies sane.
 */
// A reference is only a reference when it is unambiguous, or when the message
// is actually aimed at the bot. "I woke up at 7" is a bedtime, not Psalm 7;
// "Job 3" is Scripture only when the bot was called or the book is spelled out.
const AMBIGUOUS_BOOKS = new Set(['JOB', 'ACT', 'ROM', 'JAM', 'DAN', 'RUT', 'EST', 'JUD', 'JOL', 'AMO', 'MIC', 'NAM', 'HAG', 'LAM', 'TIT', 'MRK']);
const BOT_CALLED_RE = /@\d{5,}|blue\s?hunter/i;
// Plain talk about time or everyday numbers, which must never be read as a
// chapter and verse.
const TIME_CONTEXT_RE = /\b(?:woke|wake|waking|slept|sleeping|clock|alarm|o'?clock)\b|\b\d{1,2}\s*(?:am|pm)\b|\b(?:at|by|around|before|after)\s+\d{1,2}\s*(?::\d{2})?\b/i;

function extractReferences(text) {
  if (!text) return [];
  const addressed = BOT_CALLED_RE.test(text);
  const results = [];
  const matchedReferenceStarts = new Set();
  let match;
  CHAPTER_VERSE_RE.lastIndex = 0;
  while ((match = CHAPTER_VERSE_RE.exec(text)) && results.length < 3) {
    matchedReferenceStarts.add(match.index);
    const before = text.slice(0, match.index).trim();
    const words = before.split(/\s+/).filter(Boolean);

    for (const wordCount of [3, 2, 1]) {
      if (words.length < wordCount) continue;
      const candidate = words.slice(-wordCount).join(' ');
      const book = resolveBook(candidate);
      if (book && (addressed || !AMBIGUOUS_BOOKS.has(book.id))) {
        results.push({
          book,
          chapter: parseInt(match[1], 10),
          verseStart: parseInt(match[2], 10),
          verseEnd: match[3] ? parseInt(match[3], 10) : null,
        });
        break;
      }
    }
  }

  CHAPTER_ONLY_RE.lastIndex = 0;
  while ((match = CHAPTER_ONLY_RE.exec(text)) && results.length < 3) {
    if (/^\s*:/.test(text.slice(match.index + match[0].length)) || matchedReferenceStarts.has(match.index)) continue;
    const before = text.slice(0, match.index).trim();
    const words = before.split(/\s+/).filter(Boolean);

    for (const wordCount of [3, 2, 1]) {
      if (words.length < wordCount) continue;
      const candidate = words.slice(-wordCount).join(' ');
      const book = resolveBook(candidate);
      const timeLike = !addressed && TIME_CONTEXT_RE.test(before);
      if (book && !timeLike && (addressed || !AMBIGUOUS_BOOKS.has(book.id))) {
        results.push({
          book,
          chapter: parseInt(match[1], 10),
          verseStart: 1,
          verseEnd: null,
        });
        break;
      }
    }
  }
  return results;
}

/**
 * Joins per-verse results into the final display text. A single verse is
 * shown plain; a range gets one line per verse with the verse number bolded
 * ("*1.* In the beginning..."), e.g. for "Genesis 1:1-5".
 */
function formatVerses(verses) {
  if (verses.length <= 1) return verses[0]?.text || '';
  return verses.map((v) => `*${v.number}.* ${v.text}`).join('\n');
}

/** Fetches and formats one resolved reference as real verse text (never AI-generated). Uses the given translation code, falling back to the configured default. Routes NLT-family codes to api.nlt.to, everything else to api.bible. */
async function fetchReferenceText({ book, chapter, verseStart, verseEnd }, translationCode) {
  const code = (translationCode || BIBLE_TRANSLATION || 'NLT').trim().toUpperCase();
  const reference = verseEnd
    ? `${book.name} ${chapter}:${verseStart}-${verseEnd}`
    : `${book.name} ${chapter}:${verseStart}`;

  if (NLT_CODES.has(code)) {
    const verses = await getPassageVerses(reference, code);
    if (!verses.length) return null;
    return { reference, text: formatVerses(verses), translation: code };
  }

  const bibleId = await resolveBibleId(code);
  if (!bibleId) return null;

  const verses = [];
  const end = verseEnd || verseStart;
  for (let v = verseStart; v <= end; v++) {
    const text = await getVerseText(bibleId, `${book.id}.${chapter}.${v}`);
    if (text) verses.push({ number: v, text });
  }
  if (!verses.length) return null;

  return { reference, text: formatVerses(verses), translation: code };
}

module.exports = { extractReferences, fetchReferenceText, resolveBook, formatVerses };
