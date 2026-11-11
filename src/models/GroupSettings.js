const mongoose = require('mongoose');
const { DEFAULT_PREFIX } = require('../config');

const groupSettingsSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, unique: true, index: true },
    prefix: { type: String, default: DEFAULT_PREFIX },

    // group control
    isOpen: { type: Boolean, default: true }, // false = /close, only admins can chat
    reopenAt: { type: Date, default: null }, // set by a timed "lock for N minutes" request - the group reopens then
    isLocked: { type: Boolean, default: false }, // true = /lock, only admins can edit group info
    antilink: { type: Boolean, default: false },
    // WhatsApp invite links/codes antilink should let through anyway (this
    // group's own invite link, partner/sister groups, etc) - see
    // utils/antilink.js and commands/groupcontrol/antilinkignore.js
    antilinkWhitelist: { type: [String], default: [] },
    antispam: { type: Boolean, default: false },
    antiflood: { type: Boolean, default: false },
    antiraid: { type: Boolean, default: false }, // group-wide coordinated-spam lockdown
    antigroupstatus: { type: Boolean, default: false }, // blocks group-status posts and shares
    antiviewonce: { type: Boolean, default: false }, // reveals view-once photos/videos back into the group
    antiforward: { type: Boolean, default: false }, // blocks forwarded messages/media
    antibot: { type: Boolean, default: false }, // catches other bots (non-admin); action follows antilinkAction

    // action levels for antilink/antispam/antiflood/antiforward - what happens when each catches someone
    // (antigroupstatus and AI moderation are NOT here on purpose - both have fixed responses)
    antilinkAction: { type: String, enum: ['delete', 'warn', 'strike', 'kick'], default: 'warn' },
    antispamAction: { type: String, enum: ['delete', 'warn', 'strike', 'kick'], default: 'warn' },
    antifloodAction: { type: String, enum: ['delete', 'warn', 'strike', 'kick'], default: 'warn' },
    antiforwardAction: { type: String, enum: ['delete', 'warn', 'strike', 'kick'], default: 'warn' },

    // chat control
    silent: { type: Boolean, default: false },
    filterBadwords: { type: Boolean, default: false },
    // per-group custom word/phrase list, on top of the built-in profanity
    // list - see utils/badwords.js and commands/chatcontrol/badword.js
    customBadwords: { type: [String], default: [] },
    // what happens when the bad word filter catches someone - same shared
    // escalation as antilink/antispam/antiflood (see utils/moderationAction.js)
    badwordsAction: { type: String, enum: ['delete', 'warn', 'strike', 'kick'], default: 'delete' },
    autoreply: { type: Boolean, default: false },
    aiChatEnabled: { type: Boolean, default: false }, // AI chatbot personality on/off
    aiModerationEnabled: { type: Boolean, default: false }, // AI reads every message/image/video/sticker against the group description

    // welcome / goodbye
    welcomeEnabled: { type: Boolean, default: false },
    welcomeMessage: { type: String, default: 'Hello @user, welcome to {group}! 🎉' },
    goodbyeEnabled: { type: Boolean, default: false },
    goodbyeMessage: { type: String, default: 'Bye @user 👋' },

    // scheduled good morning/afternoon/evening/night messages - see
    // utils/autoGreetingScheduler.js and utils/countryOffsets.js. Country
    // determines the UTC offset used to fire at the right local time.
    autoGreetingsEnabled: { type: Boolean, default: false },
    autoGreetingsCountry: { type: String, default: '' }, // lowercase key into COUNTRY_OFFSETS
    autoGreetingsLanguage: { type: String, enum: ['english', 'pidgin'], default: 'english' },
    // last slot sent, e.g. "2026-07-06-morning" - prevents double-sending the
    // same slot on scheduler restarts/overlapping ticks, and is what stops
    // this from ever firing twice for the same slot in one day.
    lastGreetingSlot: { type: String, default: '' },

    // scheduled auto close/open (messaging lock, not the info-lock above) -
    // see utils/autoLockScheduler.js. closeTime/openTime are "HH:mm" in
    // whatever zone is set (a COUNTRY_OFFSETS key, or 'utc').
    scheduledLockEnabled: { type: Boolean, default: false },
    scheduledCloseTime: { type: String, default: '' },
    scheduledOpenTime: { type: String, default: '' },
    scheduledLockZone: { type: String, default: '' },
    // per-day dedupe trackers ("YYYY-MM-DD") - reset to '' whenever the
    // times/zone are changed, so a changed time is always followed
    // immediately rather than waiting on a stale marker from the old time.
    lastScheduledCloseWarnDate: { type: String, default: '' },
    lastScheduledCloseDate: { type: String, default: '' },
    lastScheduledOpenWarnDate: { type: String, default: '' },
    lastScheduledOpenDate: { type: String, default: '' },

    // daily automatic Bible verse - see utils/bibleScheduler.js and
    // utils/bibleApi.js. bibleTime is "HH:mm" UTC (defaults to 13:00/1pm UTC
    // when enabled without an explicit time). Verse text always comes from
    // the real Bible API (never OpenAI) - OpenAI only writes the short
    // reflection that goes alongside it.
    bibleEnabled: { type: Boolean, default: false },
    bibleTime: { type: String, default: '' }, // "HH:mm" UTC, '' means use the 13:00 default
    lastBibleQuoteDate: { type: String, default: '' }, // "YYYY-MM-DD" dedupe, same pattern as above

    // separate toggle for the in-chat verse detector (e.g. someone types
    // "Psalm 121" or "John 3:16" and the bot replies with the real text) -
    // enabled by default and independent of bibleEnabled, the daily post.
    // See utils/bibleVerseDetector.js and commands/bible/versedetect.js.
    bibleVerseDetectEnabled: { type: Boolean, default: true },
    // Per-group translation override for /verse, versedetect, and the daily
    // scheduled verse - e.g. "KJV", "NIV", "ESV". '' means use the global
    // BIBLE_TRANSLATION default from .env. See commands/bible/bibleversion.js.
    bibleVersion: { type: String, default: '' },

    // daily automatic joke - see utils/jokeScheduler.js and utils/jokesApi.js.
    // jokeTime is "HH:mm" UTC (defaults to JOKE_DEFAULT_TIME_UTC from .env
    // when enabled without an explicit time). Same dedupe pattern as bible.
    jokesEnabled: { type: Boolean, default: false },
    jokesType: { type: String, enum: ['dad', 'mom'], default: 'dad' },
    jokesTime: { type: String, default: '' }, // "HH:mm" UTC, '' means use the default
    lastJokeDate: { type: String, default: '' }, // "YYYY-MM-DD" dedupe, same pattern as bible

    // auto-kick inactive members - see utils/autoKick.js, utils/autoKickScheduler.js
    // and commands/groupcontrol/autokick.js. Removes members with autoKickMaxMessages
    // or fewer tracked messages once they've been in the group longer than
    // autoKickGraceHours. Admins, members with no tracked join time, and anyone
    // still inside the grace time are never removed.
    autoKickEnabled: { type: Boolean, default: false },
    autoKickMaxMessages: { type: Number, default: 0, min: 0, max: 50 },
    autoKickGraceHours: { type: Number, default: 24, min: 1, max: 720 },

    // group-wide activity tracking (distinct from per-user Activity model) -
    // used to detect and leave prolonged-inactive groups
    lastActivityAt: { type: Date, default: Date.now },
    lastBumpedAt: { type: Date, default: null },
    directoryDiscoverable: { type: Boolean, default: false },
    directoryFlairs: {
      type: [{
        type: String,
        enum: [
          'Friendly', 'SFW', 'NSFW', 'Politics', 'Religion', 'Vawulence',
          'Roast', 'Active', 'Giveaway', 'No underage', 'Bot', 'Gamer',
          'Technology', 'Nigeria', 'Ghana', 'Kenya', 'South Africa',
          'United Kingdom', 'United States',
        ],
      }],
      default: [],
    },

    // whether the one-time join intro (see utils/introMessage.js) has been
    // sent for this group yet. Deliberately a persisted flag rather than
    // "does a GroupSettings doc exist for this groupId" - a plain chat
    // message arriving around the same moment the bot is added can create
    // this doc first (via GroupSettings.getOrCreate in events/message.js),
    // which used to race the group-participants.update handler's own
    // doc-existence check and skip the intro. Existing groups from before
    // this field existed are backfilled to true in database/connect.js so
    // they don't get re-introduced.
    introduced: { type: Boolean, default: false },

    // set when the bot auto-leaves a group over a mandatory safety violation
    // (see utils/groupSafety.js). Deliberately NOT cleared automatically -
    // only /allowgroup (owner-only, from DM) can clear it, after a real
    // conversation in the support group.
    autoLeftForSafety: { type: Boolean, default: false },
    autoLeftAt: { type: Date, default: null },
    autoLeftGroupName: { type: String, default: '' }, // cached since we lose live metadata access after leaving

    // owner-only opt-out (see commands/system/allownsfw.js) from the general
    // adult-content auto-leave threshold in utils/groupSafety.js. Default is
    // true so the bot does not leave groups for normal NSFW posts, while the
    // sexual/minors zero-tolerance check still always applies regardless.
    nsfwAllowed: { type: Boolean, default: true },

    // Passive contextual banter - skull reaction on WTF variants and
    // rate-limited replies to selected chat phrases. See utils/ragebait.js.
    ragebaitEnabled: { type: Boolean, default: true },

    // spam/flood tracking helpers (reset on window expiry, kept lightweight)
    recentMessageTimestamps: { type: Map, of: [Number], default: {} },
  },
  { timestamps: true }
);

groupSettingsSchema.statics.getOrCreate = async function (groupId) {
  const existing = await this.findOne({ groupId });
  if (existing) return existing;
  try {
    return await this.create({ groupId });
  } catch (err) {
    // Several messages from a brand-new group can arrive at the same instant
    // and all try to create the doc; groupId is unique, so the losers get a
    // duplicate-key error. That just means someone else created it - read it.
    if (err && err.code === 11000) return this.findOne({ groupId });
    throw err;
  }
};

module.exports = mongoose.model('GroupSettings', groupSettingsSchema);