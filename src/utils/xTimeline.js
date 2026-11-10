const { fetchWithTimeout } = require('./http');
const { X_RSS_URLS } = require('../config');
const logger = require('./logger');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Tweet IDs are snowflakes: bigger = newer. Compare as BigInt.
function isNewer(a, b) {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return false;
  }
}

function normalizeUsername(input) {
  if (!input) return null;
  let s = String(input).trim();
  const m = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i.exec(s);
  if (m) s = m[1];
  s = s.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s.toLowerCase() : null;
}

function decode(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}


// Raw description HTML (CDATA or entity-escaped) -> image URLs on pbs.twimg.com.
// Nitter proxies images as /pic/...; converted back to the real CDN so they
// keep working even if the Nitter instance goes down.
function extractImages(rawBlock) {
  const raw = rawBlock.match(/<(?:description|content|summary)[^>]*>([\s\S]*?)<\/(?:description|content|summary)>/)?.[1] || '';
  let html = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  if (/&lt;(?:img|video)/i.test(html)) {
    html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  }
  const urls = [];
  // <img src> plus <video poster> (the thumbnail, used as fallback if the video can't be sent)
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']|<video[^>]+poster=["']([^"']+)["']/gi)) {
    m[1] = m[1] || m[2];
    let u = m[1].replace(/&amp;/g, '&');
    if (/profile_images|emoji|abs\.twimg\.com/i.test(u)) continue;
    const pic = /\/pic\/(.+)$/.exec(u);
    if (pic) {
      let path = decodeURIComponent(pic[1]).replace(/^(?:orig\/|enc\/[^/]+\/)/, '');
      u = /^https?:\/\//.test(path) ? path : `https://pbs.twimg.com/${path}`;
    }
    if (/^https?:\/\//.test(u) && !urls.includes(u)) urls.push(u);
  }
  return urls.slice(0, 4);
}

// Video (or GIF) info from the raw description HTML. RSSHub puts the real
// video.twimg.com mp4 in <source>/<video>; Nitter proxies it via /video/.
// hasVideo is true even when only a poster thumbnail is present, so the
// caller can look the mp4 up with resolveVideoUrl().
function extractVideo(rawBlock) {
  const raw = rawBlock.match(/<(?:description|content|summary)[^>]*>([\s\S]*?)<\/(?:description|content|summary)>/)?.[1] || '';
  let html = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  if (/&lt;(?:img|video)/i.test(html)) {
    html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  }
  const hasVideo = /<video[\s>]/i.test(html) || /(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)/i.test(html);
  let videoUrl = null;
  for (const m of html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) {
    let u = m[1].replace(/&amp;/g, '&');
    const nv = /\/video\/[^/]+\/(.+)$/.exec(u);
    if (nv) u = decodeURIComponent(nv[1]);
    if (/^https?:\/\//.test(u) && /\.mp4(\?|$)/i.test(u)) {
      videoUrl = u;
      break;
    }
  }
  return { hasVideo: hasVideo || !!videoUrl, videoUrl };
}

// Free, keyless lookup of a post's mp4 (FxTwitter API). Returns null on any failure.
async function resolveVideoUrl(username, tweetId) {
  try {
    const res = await fetchWithTimeout(`https://api.fxtwitter.com/${encodeURIComponent(username)}/status/${tweetId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BluehunterBot)' },
    }, 15_000);
    if (!res.ok) return null;
    const data = await res.json();
    const vids = data?.tweet?.media?.videos || [];
    const v = vids.find((x) => /\.mp4(\?|$)/i.test(x?.url || '')) || null;
    return v ? { url: v.url, isGif: v.type === 'gif' } : null;
  } catch {
    return null;
  }
}

// Works for RSS 2.0 (<item>: Nitter, RSSHub) and Atom (<entry>).
function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
  const tweets = [];
  for (const b of blocks) {
    const link =
      b.match(/<link>([^<]+)<\/link>/)?.[1] ||
      b.match(/<link[^>]*href="([^"]+)"/)?.[1] ||
      b.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1] ||
      '';
    const id = /\/status\/(\d+)/.exec(link)?.[1] || /^(\d{10,})$/.exec(b.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1] || '')?.[1];
    if (!id) continue;
    const title = decode(b.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]);
    const desc = decode(b.match(/<(?:description|content|summary)[^>]*>([\s\S]*?)<\/(?:description|content|summary)>/)?.[1]);
    const text = title || desc;
    if (/^R to @/i.test(text)) continue; // Nitter marks replies like this
    tweets.push({ id, text, name: '', images: extractImages(b), ...extractVideo(b) });
  }
  tweets.sort((a, b) => (isNewer(a.id, b.id) ? -1 : isNewer(b.id, a.id) ? 1 : 0));
  return tweets;
}

/**
 * Latest posts for a user, newest first, via RSS. Tries each template in
 * X_RSS_URLS in order ({username} is substituted) until one returns posts.
 * Throws only if every source failed; returns [] if feeds loaded but empty.
 */
async function fetchLatestTweets(username, { timeoutMs = 30_000 } = {}) {
  let lastErr = null;
  let sawEmptyOk = false;
  for (const tpl of X_RSS_URLS) {
    const url = tpl.replace('{username}', encodeURIComponent(username));
    try {
      const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tweets = parseFeed(await res.text());
      if (tweets.length) return tweets;
      sawEmptyOk = true;
      logger.warn(`X RSS ${new URL(url).host}: feed loaded but no posts found for ${username}`);
    } catch (err) {
      lastErr = err;
      logger.warn(`X RSS ${new URL(url).host} failed for ${username}: ${err.message}`);
    }
  }
  if (sawEmptyOk) return [];
  throw lastErr || new Error('No X RSS sources configured (set X_RSS_URLS)');
}

module.exports = { fetchLatestTweets, normalizeUsername, isNewer, parseFeed, extractImages, extractVideo, resolveVideoUrl };