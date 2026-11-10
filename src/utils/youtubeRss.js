const { fetchWithTimeout } = require('./http');
const { YOUTUBE_API_KEY } = require('../config');

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

/**
 * Resolves whatever a user pastes (a raw channel ID, a full channel/handle
 * URL, or a bare handle) into a real YouTube channel ID (UCxxxxxxxxxxxxxxxxxxxxxxx).
 * The RSS feed endpoint below only accepts a real channel ID - it does NOT
 * work with a @handle or a /c/ or /user/ custom URL, which is what most
 * people will actually have on hand, so this always resolves down to the
 * real ID first via a lightweight page fetch (no API key, no YouTube Data
 * API quota - just reading the same canonical-URL metadata every YouTube
 * page already ships in its HTML).
 *
 * Returns { channelId, channelTitle } or null if it couldn't be resolved
 * (bad input, channel doesn't exist, YouTube changed their page markup, etc).
 */
async function resolveChannelId(input) {
  const raw = (input || '').trim();
  if (!raw) return null;

  // Already a real channel ID - no fetch needed.
  const directIdMatch = raw.match(/(?:^|\/channel\/)(UC[\w-]{22})(?:$|[/?])/);
  if (directIdMatch && CHANNEL_ID_RE.test(directIdMatch[1])) {
    // Still need the display title for friendly messages - one lightweight fetch.
    return fetchChannelPage(`https://www.youtube.com/channel/${directIdMatch[1]}`, directIdMatch[1]);
  }

  let url;
  if (/^https?:\/\//i.test(raw)) {
    url = raw;
  } else if (raw.startsWith('@')) {
    url = `https://www.youtube.com/${raw}`;
  } else {
    // Bare name with no @ - most likely meant as a handle.
    url = `https://www.youtube.com/@${raw}`;
  }

  return fetchChannelPage(url, null);
}

async function fetchChannelPage(url, knownChannelId) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const html = await res.text();

    const channelId =
      knownChannelId ||
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] ||
      html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ||
      null;
    if (!channelId) return null;

    // Best-effort display name - falls back to the channel ID itself if the
    // page markup ever changes shape, so a title lookup failure never blocks
    // adding a channel that otherwise resolved fine.
    const channelTitle = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || channelId;

    // Subscriber count: "header":{"pageHeaderRenderer" appears EXACTLY ONCE
    // per page (the page's own channel header) - unlike most other fields
    // on a channel page (channelId, subscriberCountText, etc.), which also
    // appear repeatedly for unrelated related/recommended channels shown
    // elsewhere on the page. Searching the WHOLE page for "X subscribers"
    // picks up one of THOSE instead more often than not - scoping the
    // search to just the text after this one unique anchor is what makes
    // it reliable. Verified against multiple real channels of very
    // different sizes (500K to 500M+ subscribers) before relying on this.
    const headerIdx = html.indexOf('"header":{"pageHeaderRenderer"');
    const headerWindow = headerIdx === -1 ? '' : html.slice(headerIdx, headerIdx + 5000);
    const subscriberCount = headerWindow.match(/"content":"([\d.,]+[KMB]?\s*subscribers?)"/)?.[1] || null;

    return { channelId, channelTitle: decodeHtmlEntities(channelTitle), subscriberCount };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Describes upload frequency in a friendly way from a list of recent videos
 * (as returned by fetchLatestVideos, newest-first) - purely arithmetic on
 * dates the RSS feed already gave us, no extra fetch or scraping involved.
 * Needs at least 2 videos to say anything meaningful. Returns null if there
 * isn't enough data (a brand new channel, or a feed fetch that came back thin).
 */
function describePostingFrequency(videos) {
  if (!videos || videos.length < 2) return null;
  const dated = videos.filter((v) => v.publishedAt).sort((a, b) => b.publishedAt - a.publishedAt);
  if (dated.length < 2) return null;

  const spanMs = dated[0].publishedAt - dated[dated.length - 1].publishedAt;
  const spanDays = spanMs / (1000 * 60 * 60 * 24);
  if (spanDays <= 0) return null;

  const perDay = (dated.length - 1) / spanDays;

  if (perDay >= 1) return `about ${Math.round(perDay)}x per day`;
  if (perDay >= 1 / 7) {
    const perWeek = perDay * 7;
    return `about ${perWeek >= 1.5 ? Math.round(perWeek) : perWeek.toFixed(1)}x per week`;
  }
  const perMonth = perDay * 30;
  return `about ${Math.max(1, Math.round(perMonth))}x per month`;
}

/**
 * Fetches a channel's upload feed (newest first, YouTube only ever includes
 * the most recent ~15 uploads - this is not paginated history, just "what's
 * new"). Returns an array of { videoId, title, url, isShort, publishedAt },
 * or null on any fetch/parse failure (fails soft - a feed hiccup should
 * never crash the scheduler, just skip this channel until the next tick).
 */
async function fetchLatestVideos(channelId) {
  try {
    const res = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
    if (!res.ok) return null;
    const xml = await res.text();

    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
    return entries
      .map((entry) => {
        const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
        const title = entry.match(/<title>([^<]*)<\/title>/)?.[1];
        const link = entry.match(/<link rel="alternate" href="([^"]+)"/)?.[1];
        const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1];
        if (!videoId || !title || !link) return null;
        return {
          videoId,
          title: decodeHtmlEntities(title),
          url: link,
          isShort: link.includes('/shorts/'),
          publishedAt: publishedAt ? new Date(publishedAt) : null,
        };
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** Compact "5.1B" / "518M" / "21.3K" style formatting for a raw count. */
function formatCount(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K`;
  return String(n);
}

/**
 * Official YouTube Data API lookup - the ONLY reliable way to get total
 * channel views (see the long comment in fetchChannelPage: that stat isn't
 * present in a channel page's server-rendered HTML at all, it loads via a
 * separate request the browser makes afterward, so there's nothing to
 * scrape). Also returns subscriberCount and videoCount, which callers can
 * use in place of the scraped versions when this succeeds - the official
 * numbers are exact rather than an already-rounded display string.
 *
 * Returns null if YOUTUBE_API_KEY isn't set, or on any failure - this is
 * always an optional enhancement on top of the free RSS-only path, never
 * something /ytalert depends on to function.
 */
async function fetchChannelStats(channelId) {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    const stats = data.items?.[0]?.statistics;
    if (!stats) return null;

    return {
      viewCount: stats.viewCount ? `${formatCount(Number(stats.viewCount))} views` : null,
      // hiddenSubscriberCount: some creators turn this off - respect that
      // rather than showing a stale/scraped number in its place.
      subscriberCount: stats.hiddenSubscriberCount || !stats.subscriberCount ? null : `${formatCount(Number(stats.subscriberCount))} subscribers`,
      videoCount: stats.videoCount || null,
    };
  } catch {
    return null;
  }
}

module.exports = { resolveChannelId, fetchLatestVideos, describePostingFrequency, fetchChannelStats };
