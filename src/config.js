require('dotenv').config();

const clean = (num = '') => num.toString().replace(/[^0-9]/g, '');

module.exports = {
  MONGODB_URI: process.env.MONGODB_URI,
  OWNER_NUMBER: clean(process.env.OWNER_NUMBER),
  OWNER_JID: `${clean(process.env.OWNER_NUMBER)}@s.whatsapp.net`, // Baileys uses @s.whatsapp.net, not @c.us
  // Optional: your own @lid identifier, needed because group messages you send
  // show up with an @lid sender id, not your real number. Get this by running
  // /whoami in a group once, then paste the id (without @lid) here.
  OWNER_LID: (process.env.OWNER_LID || '').replace(/[^0-9]/g, ''),
  SUPPORT_GROUP_LINK: process.env.SUPPORT_GROUP_LINK || 'https://chat.whatsapp.com/Dqk0IjZseMI72i29L3tG1x',
  DEFAULT_PREFIX: process.env.DEFAULT_PREFIX || '/',
  BOT_NAME: process.env.BOT_NAME || 'Bluehunter',
  BOT_MODE_DEFAULT: process.env.BOT_MODE || 'public',
  // Baileys stores multi-file auth creds here (replaces whatsapp-web.js's LocalAuth dataPath)
  SESSION_PATH: process.env.SESSION_PATH || '.baileys_auth',
  // AI chatbot (optional feature, off unless OPENAI_API_KEY is set and a group enables it)
  // Low-risk mode keeps a bot quiet and less "chatty" by default, which helps
  // avoid appearing spammy on WhatsApp while still leaving the core moderation features alive.
  LOW_RISK_MODE: process.env.LOW_RISK_MODE !== '0',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'gpt-4o-mini',
  // AI chat stays rate-limited without feeling unresponsive; the limiter
  // enforces a one-minute minimum, per-sender cooldown, and a rolling cap.
  AI_REPLY_COOLDOWN_MS: parseInt(process.env.AI_REPLY_COOLDOWN_MS || '60000', 10),
  // Someone answering a question the bot itself asked is mid-conversation, so
  // it can answer back sooner than a fresh mention would allow.
  AI_FOLLOWUP_COOLDOWN_MS: parseInt(process.env.AI_FOLLOWUP_COOLDOWN_MS || '10000', 10),
  // Ambient mode: small chance the bot jumps into conversation unprompted, like
  // a human lurker, instead of only replying when directly addressed.
  AI_AMBIENT_CHANCE: parseFloat(process.env.AI_AMBIENT_CHANCE || '0'), // default off for low-risk safety
  AI_AMBIENT_COOLDOWN_MS: parseInt(process.env.AI_AMBIENT_COOLDOWN_MS || '120000', 10), // 2m between ambient replies
  // Leave groups with no activity for this many days
  INACTIVE_GROUP_DAYS: parseInt(process.env.INACTIVE_GROUP_DAYS || '30', 10),
  // How often to check for inactive groups (default: every 12 hours)
  INACTIVE_GROUP_CHECK_INTERVAL_MS: parseInt(process.env.INACTIVE_GROUP_CHECK_INTERVAL_MS || String(12 * 60 * 60 * 1000), 10),
  // How often to check whether it's time to send a scheduled good morning/
  // afternoon/evening/night message (default: every 2 minutes in low-risk mode)
  AUTO_GREETING_CHECK_INTERVAL_MS: parseInt(process.env.AUTO_GREETING_CHECK_INTERVAL_MS || (process.env.LOW_RISK_MODE !== '0' ? '120000' : '60000'), 10),
  // How often to check for inactive members to auto-kick (default: every 10 minutes)
  AUTO_KICK_CHECK_INTERVAL_MS: parseInt(process.env.AUTO_KICK_CHECK_INTERVAL_MS || '600000', 10),
  // How often to check whether a reminder post is due (default: every 60 seconds)
  REMINDERPOST_CHECK_INTERVAL_MS: parseInt(process.env.REMINDERPOST_CHECK_INTERVAL_MS || '60000', 10),
  // How often to check scheduled group close/open times (default: every 60s
  // in low-risk mode so scheduled locks don't fire too aggressively)
  AUTO_LOCK_CHECK_INTERVAL_MS: parseInt(process.env.AUTO_LOCK_CHECK_INTERVAL_MS || (process.env.LOW_RISK_MODE !== '0' ? '60000' : '30000'), 10),

  // How often to poll watched YouTube channels' RSS feeds for new uploads.
  // Unlike the schedulers above, this isn't tied to a specific clock time -
  // a few minutes' delay before an alert posts is fine, so this defaults
  // much longer (5 min) to keep the number of requests to youtube.com low,
  // especially once several groups are each watching several channels.
  YOUTUBE_ALERT_CHECK_INTERVAL_MS: parseInt(process.env.YOUTUBE_ALERT_CHECK_INTERVAL_MS || (process.env.LOW_RISK_MODE !== '0' ? '300000' : '180000'), 10),

  // How often to poll watched X accounts for new posts (one RSS request per
  // unique account per tick). The shorter default keeps alert latency low.
  X_ALERT_CHECK_INTERVAL_MS: parseInt(process.env.X_ALERT_CHECK_INTERVAL_MS || '30000', 10),

  // X has no native RSS. Comma-separated feed URL templates, tried in order;
  // {username} is replaced. Examples: your own RSSHub  https://rsshub.example.com/twitter/user/{username}
  // or a Nitter instance  https://nitter.example.com/{username}/rss
  X_RSS_URLS: (process.env.X_RSS_URLS || 'https://nitter.net/{username}/rss').split(',').map((s) => s.trim()).filter(Boolean),

  // Compensates for the HOST MACHINE's own system clock being wrong, not
  // for timezone math (that's countryOffsets.js, and it's correct - Nigeria
  // really is UTC+1/WAT). If every scheduled feature fires a consistent N
  // hours off from real time no matter what country/offset is configured,
  // the underlying system clock itself is the problem (common on VPS/
  // container hosts without NTP sync) - this shifts every scheduler's
  // notion of "now" by a fixed amount to compensate, without touching the
  // actual offset table. 0 = no correction (the default - most hosts don't
  // need this at all). See utils/serverClock.js.
  SYSTEM_CLOCK_DRIFT_HOURS: parseInt(process.env.SYSTEM_CLOCK_DRIFT_HOURS || '0', 10),
  // /ytmp3 and /ytmp4 guardrails - keep downloads short and small enough that
  // they don't tie up the bot's memory/bandwidth on one request.
  YT_MAX_DURATION_MINUTES: parseInt(process.env.YT_MAX_DURATION_MINUTES || '15', 10),
  YT_MAX_FILE_SIZE_MB: parseInt(process.env.YT_MAX_FILE_SIZE_MB || '90', 10),
  // Daily automatic Bible verse (see utils/bibleScheduler.js). Verse text is
  // always pulled live from the Bible API below - never generated by OpenAI -
  // OpenAI is only used to write the short reflection alongside it.
  // Daily automatic Bible verse (see utils/bibleScheduler.js) and in-chat
  // verse lookup (see utils/bibleVerseDetector.js). Runs on api.bible
  // (scripture.api.bible) - unlike the old free helloao API, this one
  // supports copyrighted modern translations (NLT, NIV, ESV, etc.) as long
  // as your API key/plan has access to them, alongside public-domain ones
  // (KJV, ASV, WEB...). Key lives in .env only - never hardcode it.
  BIBLE_API_KEY: process.env.BIBLE_API_KEY || '',
  BIBLE_API_BASE: process.env.BIBLE_API_BASE || 'https://rest.api.bible/v1',
  // Default translation code, used whenever a group hasn't set its own via
  // /bibleversion. Must match a Bible actually available to your API key -
  // run /bibleversion list in a group to see what's accessible.
  BIBLE_TRANSLATION: process.env.BIBLE_TRANSLATION || 'NLT',
  BIBLE_DEFAULT_TIME_UTC: process.env.BIBLE_DEFAULT_TIME_UTC || '13:00', // 1pm UTC
  BIBLE_CHECK_INTERVAL_MS: parseInt(process.env.BIBLE_CHECK_INTERVAL_MS || (process.env.LOW_RISK_MODE !== '0' ? '120000' : '60000'), 10),
  // Daily automatic dad/mom joke (see utils/jokeScheduler.js). Both jokes
  // pull from free, keyless public APIs - icanhazdadjoke.com and
  // api.yomomma.info - no key needed, nothing to put in .env for these.
  JOKE_DEFAULT_TIME_UTC: process.env.JOKE_DEFAULT_TIME_UTC || '09:00',
  JOKE_CHECK_INTERVAL_MS: parseInt(process.env.JOKE_CHECK_INTERVAL_MS || (process.env.LOW_RISK_MODE !== '0' ? '180000' : '60000'), 10),
  // api.bible doesn't carry NLT (it's copyrighted and not on our plan), so
  // NLT/NLTUK/NTV are served separately via Tyndale's own api.nlt.to. Key
  // lives in .env only - never hardcode it. Get one at api.nlt.to/Account/Register.
  NLT_API_KEY: process.env.NLT_API_KEY || '',
  NLT_API_BASE: process.env.NLT_API_BASE || 'https://api.nlt.to/api',
  // api.nlt.to has no "list all books/chapters/verses" endpoint, so /verse's
  // random NLT pick borrows this public-domain translation from api.bible
  // purely to land on a valid book/chapter/verse, then fetches the real
  // text for that reference from the NLT API. Must be a translation your
  // api.bible key actually has (KJV is on every plan).
  NLT_STRUCTURE_TRANSLATION: process.env.NLT_STRUCTURE_TRANSLATION || 'KJV',
  // /ig, /x, /spotify - all run through RapidAPI now instead of Apify.
  // Key lives in .env only - never hardcode it, it's a live credential.
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY || '',
  RAPIDAPI_INSTAGRAM_HOST: process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
  RAPIDAPI_TWITTER_HOST: process.env.RAPIDAPI_TWITTER_HOST || 'twitter-api45.p.rapidapi.com',
  RAPIDAPI_SPOTIFY_HOST: process.env.RAPIDAPI_SPOTIFY_HOST || 'spotify-downloader9.p.rapidapi.com',
  RAPIDAPI_YOUTUBE_HOST: process.env.RAPIDAPI_YOUTUBE_HOST || 'youtube138.p.rapidapi.com',
  // /ytmp3 and /ytmp4 now run on the dedicated converter APIs below instead
  // of youtube138's /video/streams (which the line above is kept around for,
  // in case anything else still points at it).
  RAPIDAPI_YOUTUBE_MP3_HOST: process.env.RAPIDAPI_YOUTUBE_MP3_HOST || 'youtube-mp36.p.rapidapi.com',
  RAPIDAPI_YOUTUBE_MP4_HOST: process.env.RAPIDAPI_YOUTUBE_MP4_HOST || 'youtube-mp41.p.rapidapi.com',
  SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB: parseInt(process.env.SOCIAL_DOWNLOAD_MAX_FILE_SIZE_MB || '90', 10),
  // AI chat's auto-sticker reactions (see utils/aiChat.js, utils/giphyClient.js) -
  // searches GIPHY for a reaction gif and sends it as a WhatsApp sticker. Get
  // a free "API" key (not "SDK") at https://developers.giphy.com. Feature
  // just silently no-ops without a key - AI chat's text replies work fine
  // either way.
  GIPHY_API_KEY: process.env.GIPHY_API_KEY || '',
  // Optional - only used to show total channel views on /ytalert add (that
  // one stat genuinely isn't available any other way - see youtubeRss.js).
  // Free to get: console.cloud.google.com -> enable "YouTube Data API v3" ->
  // Credentials -> Create API Key. No billing account needed for this usage
  // level (1 unit per channel added, default quota is 10,000/day). Without
  // this set, /ytalert still works fully - it just falls back to the
  // page-scrape method for subscriber count and skips total views.
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
  // Temporary deleted-message audit logs for admins. Auto-expire after a while
  // to keep storage from piling up indefinitely.
  DELETED_MESSAGE_LOG_TTL_MS: parseInt(process.env.DELETED_MESSAGE_LOG_TTL_MS || String(6 * 60 * 60 * 1000), 10),
  DELETED_MESSAGE_LOG_PAGE_SIZE: parseInt(process.env.DELETED_MESSAGE_LOG_PAGE_SIZE || '5', 10),
  // YarnGPT powers AI chat voice notes. Voice is resolved by display name
  // against the live catalogue because provider voice IDs can change.
  YARNGPT_API_KEY: process.env.YARNGPT_API_KEY || '',
  YARNGPT_TTS_VOICE: process.env.YARNGPT_TTS_VOICE || 'Nonso',
  // Stability knobs (all optional - the defaults are fine for most setups).
  // MAX_CONCURRENT_MESSAGES: how many incoming messages are processed at the
  // same time; the rest queue. Low-risk mode lowers this to stay quieter and
  // easier on WhatsApp. Raise it only if sustained load needs it.
  MAX_CONCURRENT_MESSAGES: parseInt(process.env.MAX_CONCURRENT_MESSAGES || (process.env.LOW_RISK_MODE !== '0' ? '5' : '10'), 10),
  // One message taking longer than this (ms) stops blocking the queue.
  MESSAGE_TASK_TIMEOUT_MS: parseInt(process.env.MESSAGE_TASK_TIMEOUT_MS || (process.env.LOW_RISK_MODE !== '0' ? '120000' : '90000'), 10),
  // Minimum gap (ms) between the START of two outgoing messages. Smooths out
  // bursts (many groups running commands at once) so WhatsApp doesn't see a
  // machine-gun of sends (each gap is randomly +/-40% so it isn't a metronome).
  // 0 = off. Deletes are never delayed.
  SEND_GAP_MS: parseInt(process.env.SEND_GAP_MS || (process.env.LOW_RISK_MODE !== '0' ? '2500' : '1200'), 10),
  // Ban-risk reducers (see the comments in .env). READ_BEFORE_REPLY: mark a
  // command message as read before answering it, like a person would.
  // BIBLE_MENTION_ALL: the daily verse silently pings EVERY member when on -
  // a common reason people mute/report/block a bot number.
  // Welcome/goodbye messages: when several people join (or leave) the same
  // group within this many ms of each other, they get ONE message that
  // mentions everyone instead of one message each (e.g. after "approve all").
  WELCOME_BATCH_QUIET_MS: parseInt(process.env.WELCOME_BATCH_QUIET_MS || '5000', 10),
  // Downloader commands (/ytmp3 /ytmp4 /ig /x /spotify) hold whole files in
  // memory while they download AND while Baileys uploads them. This many run
  // at once; the rest wait (a few at most - see DOWNLOAD_MAX_QUEUE).
  DOWNLOAD_CONCURRENCY: Math.max(1, parseInt(process.env.DOWNLOAD_CONCURRENCY || '1', 10) || 1),
  DOWNLOAD_MAX_QUEUE: parseInt(process.env.DOWNLOAD_MAX_QUEUE || '4', 10),
  // QR login is the default/recommended mode for Baileys. Only set this to a
  // phone number if you intentionally want the pairing-code flow instead.
  // Leave it empty to keep using the QR code.
  PAIRING_NUMBER: (process.env.PAIRING_NUMBER || '').replace(/[^0-9]/g, ''),
  // After WhatsApp logs the bot out, automatically set the dead session aside
  // and request a fresh pairing code (only used together with PAIRING_NUMBER).
  AUTO_RELINK: process.env.AUTO_RELINK !== '0',
  READ_BEFORE_REPLY: process.env.READ_BEFORE_REPLY !== '0',
  BIBLE_MENTION_ALL: process.env.BIBLE_MENTION_ALL === '1',
};