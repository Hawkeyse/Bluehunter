const { fetchWithTimeout } = require('./http');
const { NLT_API_KEY, NLT_API_BASE } = require('../config');

function requireKey() {
  if (!NLT_API_KEY) throw new Error('NLT_API_KEY is not set in .env');
}

/**
 * Removes a <span class="X">...</span> block (and everything inside it) by
 * counting nested <span> opens/closes rather than matching the first
 * </span> found - footnote bodies (class="tn") contain a nested
 * <span class="tn-ref">, so a naive non-greedy regex would stop early and
 * leak the footnote text into the output.
 */
function removeBalancedSpans(html, className) {
  const openTag = `<span class="${className}">`;
  let result = '';
  let i = 0;
  while (i < html.length) {
    const idx = html.indexOf(openTag, i);
    if (idx === -1) {
      result += html.slice(i);
      break;
    }
    result += html.slice(i, idx);
    let depth = 1;
    let pos = idx + openTag.length;
    while (depth > 0 && pos < html.length) {
      const nextOpen = html.indexOf('<span', pos);
      const nextClose = html.indexOf('</span>', pos);
      if (nextClose === -1) {
        pos = html.length;
        break;
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 5;
      } else {
        depth--;
        pos = nextClose + 7;
      }
    }
    i = pos;
  }
  return result;
}

/**
 * Strips footnote markers/bodies, the embedded verse-number span (we pull
 * the number separately from the vn="" attribute), and any remaining HTML
 * tags/entities from one <verse_export> fragment, leaving clean plain text.
 */
function stripHtml(fragment) {
  let s = fragment.replace(/<a class="a-tn">[\s\S]*?<\/a>/g, '');
  s = removeBalancedSpans(s, 'tn');
  s = removeBalancedSpans(s, 'vn');
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, '\u2019')
    .replace(/&#8216;|&lsquo;/g, '\u2018')
    .replace(/&#8220;|&ldquo;/g, '\u201c')
    .replace(/&#8221;|&rdquo;/g, '\u201d')
    .replace(/&#8212;|&mdash;/g, '\u2014')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches one or more verses from the NLT API (api.nlt.to) and returns them
 * as an array of { number, text }, one entry per verse, in order.
 *
 * `ref` uses a natural typed reference, e.g. "John 3:16" or
 * "Genesis 1:1-5" - the NLT API's own /api/parse endpoint is built to
 * accept exactly this kind of human-typed string, so we pass through what
 * a person would actually type rather than re-encoding it.
 *
 * `version` - NLT (default), NLTUK, NTV (Spanish), or KJV.
 */
async function getPassageVerses(ref, version = 'NLT') {
  requireKey();
  const qs = new URLSearchParams({ ref, version, key: NLT_API_KEY }).toString();
  const res = await fetchWithTimeout(`${NLT_API_BASE}/passages?${qs}`);
  if (!res.ok) throw new Error(`NLT API ${res.status} for passages?ref=${ref}`);
  const html = await res.text();

  const verses = [];
  const verseRe = /<verse_export[^>]*\bvn="(\d+)"[^>]*>([\s\S]*?)<\/verse_export>/g;
  let match;
  while ((match = verseRe.exec(html))) {
    const text = stripHtml(match[2]);
    if (text) verses.push({ number: parseInt(match[1], 10), text });
  }
  return verses;
}

module.exports = { getPassageVerses };
