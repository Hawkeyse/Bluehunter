// BlueHunter website: public status + changelog, and a dashboard covering
// every group an admin runs. One WhatsApp number is verified once (from any
// group, via /verify) and the site then finds every group where BlueHunter
// is present AND that number is admin - not just the group /verify was
// typed in. Admin status is re-read from WhatsApp on every request, so a
// demotion removes dashboard control immediately, the same way it removes
// /kick or /antilink access in the group itself.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const GroupSettings = require('../models/GroupSettings');
const Activity = require('../models/Activity');
const GroupDailyActivity = require('../models/GroupDailyActivity');
const { INTRO_MESSAGE, markIntroduced } = require('../utils/introMessage');
const { buildChatCompat } = require('../utils/waCompat');
const { isGroupAdmin, isOwner, resolveNumber } = require('../utils/permissions');
const { COUNTRY_OFFSETS } = require('../utils/countryOffsets');
const { CHANGELOG } = require('../data/changelog');
const { listDeletedLogs, getDeletedLogCount, logsByGroup } = require('../utils/deletedLogs');
const { DELETED_MESSAGE_LOG_TTL_MS, OWNER_NUMBER } = require('../config');
const live = require('../utils/liveActivity');
const GroupMember = require('../models/GroupMember');
const ReminderPost = require('../models/ReminderPost');
const rp = require('../utils/reminderPosts');
const SiteNotice = require('../models/SiteNotice');
const audit = require('../utils/auditLog');
const AuditLog = require('../models/AuditLog');
const Warning = require('../models/Warning');
const EVIDENCE_DIR = path.resolve(path.join(__dirname, '..', '..', 'moderation-evidence'));

const CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const GROUPS_CACHE_MS = 60_000; // how long "your groups" is trusted before re-scanning
const FAIL_WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIONS = ['delete', 'warn', 'strike', 'kick'];
const PREFIXES = ['/', '!', '.', '#', '$', '%', '&', '*'];
const COUNTRIES = Object.keys(COUNTRY_OFFSETS);
const ZONES = [...COUNTRIES, 'utc'];
const JOKE_TYPES = ['dad', 'mom'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// What the dashboard may change. Anything not listed here is rejected.
const SCHEMA = [
  { title: 'Protection', items: [
    { key: 'antilink', type: 'bool', label: 'Block links', hint: 'Removes WhatsApp invites and other links', action: 'antilinkAction' },
    { key: 'antispam', type: 'bool', label: 'Block spam', hint: 'Catches people repeating themselves', action: 'antispamAction' },
    { key: 'antiflood', type: 'bool', label: 'Block flooding', hint: 'Catches too many messages too fast', action: 'antifloodAction' },
    { key: 'antiforward', type: 'bool', label: 'Block forwarded messages', action: 'antiforwardAction' },
    { key: 'antibot', type: 'bool', label: 'Block other bots', hint: 'Catches other bots (admins exempt). Uses the same action as Block links' },
    { key: 'antiraid', type: 'bool', label: 'Raid lockdown', hint: 'Locks the group when many accounts spam at once' },
    { key: 'antigroupstatus', type: 'bool', label: 'Block group-status posts' },
    { key: 'antiviewonce', type: 'bool', label: 'Reveal view-once media', hint: 'Posts view-once photos and videos back into the group' },
  ] },
  { title: 'Chat', items: [
    { key: 'filterBadwords', type: 'bool', label: 'Bad word filter', action: 'badwordsAction' },
    { key: 'customBadwords', type: 'list', label: 'Extra blocked words', hint: 'On top of the built-in filter - separate with commas' },
    { key: 'autoreply', type: 'bool', label: 'Auto replies', hint: 'Answers common phrases like hi and thanks' },
    { key: 'aiChatEnabled', type: 'bool', label: 'AI chat', hint: 'Replies when someone mentions the bot or replies to it' },
    { key: 'aiModerationEnabled', type: 'bool', label: 'AI moderation', hint: 'Checks messages against the group description' },
    { key: 'silent', type: 'bool', label: 'Silent mode', hint: 'The bot ignores normal chat; commands still work' },
  ] },
  { title: 'Welcome and goodbye', items: [
    { key: 'welcomeEnabled', type: 'bool', label: 'Welcome new members' },
    { key: 'welcomeMessage', type: 'text', label: 'Welcome message', hint: '@user becomes the member, {group} becomes the group name' },
    { key: 'goodbyeEnabled', type: 'bool', label: 'Say goodbye' },
    { key: 'goodbyeMessage', type: 'text', label: 'Goodbye message', hint: '@user becomes the member' },
  ] },
  { title: 'Scheduled messages', items: [
    { key: 'autoGreetingsEnabled', type: 'bool', label: 'Good morning/afternoon/evening/night', hint: "Sent 4 times a day in the group's local time" },
    { key: 'autoGreetingsCountry', type: 'choice', options: COUNTRIES, label: 'Greetings country', hint: 'Sets the local time zone for the greetings above' },
    { key: 'autoGreetingsLanguage', type: 'choice', options: ['english', 'pidgin'], label: 'Greeting language', hint: 'English or Nigerian Pidgin; greetings can be funny, thoughtful, prayerful, or encouraging' },
    { key: 'scheduledLockEnabled', type: 'bool', label: 'Auto close/open', hint: 'Locks and unlocks chat on a daily schedule' },
    { key: 'scheduledCloseTime', type: 'time', label: 'Close time' },
    { key: 'scheduledOpenTime', type: 'time', label: 'Open time' },
    { key: 'scheduledLockZone', type: 'choice', options: ZONES, label: 'Close/open time zone' },
    { key: 'bibleEnabled', type: 'bool', label: 'Daily Bible verse' },
    { key: 'bibleTime', type: 'time', label: 'Verse time (UTC)', hint: 'Leave blank for 13:00 UTC' },
    { key: 'bibleVerseDetectEnabled', type: 'bool', label: 'Detect verse references in chat', hint: 'E.g. "Psalm 121" returns Psalm 121:1; "John 3:16" returns that verse' },
    { key: 'bibleVersion', type: 'version', label: 'Bible translation', hint: 'E.g. KJV, NIV, ESV - leave blank for the default' },
    { key: 'jokesEnabled', type: 'bool', label: 'Daily joke' },
    { key: 'jokesType', type: 'choice', options: JOKE_TYPES, label: 'Joke type' },
    { key: 'jokesTime', type: 'time', label: 'Joke time (UTC)', hint: 'Leave blank for the default time' },
  ] },
  { title: 'Inactive members', items: [
    { key: 'autoKickEnabled', type: 'bool', label: 'Auto-remove inactive members', hint: 'Removes members with few or no messages. Admins and new joiners are never removed' },
    { key: 'autoKickMaxMessages', type: 'number', min: 0, max: 50, label: 'Remove members with this many messages or fewer', hint: '0 = only people who never wrote anything, 1 = also people who wrote once' },
    { key: 'autoKickGraceHours', type: 'number', min: 1, max: 720, label: 'Grace time for new members (hours)', hint: 'Nobody is removed until they have been in the group this long. 24 = one day' },
  ] },
  { title: 'Commands', items: [
    { key: 'prefix', type: 'choice', options: PREFIXES, label: 'Command prefix' },
  ] },
];
const RULES = {};
for (const s of SCHEMA) {
  for (const it of s.items) {
    RULES[it.key] = it;
    if (it.action) RULES[it.action] = { type: 'choice', options: ACTIONS, label: `${it.label} action` };
  }
}

const codes = new Map(); // CODE -> { senderId, expires }
const sessions = new Map(); // token -> { expires, senderId, groupsCache: { at, list } }
const fails = new Map(); // ip -> [timestamps]
let ctx = { sock: null, getStatus: null };
let lagMs = 0;
let indexHtml = null;

const webEnabled = () => String(process.env.WEB_ENABLED || 'true').toLowerCase() !== 'false';
const webUrl = () => (process.env.WEB_URL || '').replace(/\/+$/, '');

function issueCode(senderId) {
  for (const [c, e] of codes) if (e.senderId === senderId) codes.delete(c);
  let code;
  do {
    code = Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  } while (codes.has(code));
  codes.set(code, { senderId, expires: Date.now() + CODE_TTL_MS });
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

const htmlCache = new Map();
// Serves a static page from this folder: index.html is the admin dashboard,
// join.html is the public "invite me to your group" homepage.
function page(res, file = 'index.html') {
  if (!htmlCache.has(file)) htmlCache.set(file, fs.readFileSync(path.join(__dirname, file)));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(htmlCache.get(file));
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSession(req) {
  const token = cookies(req).bh_session;
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
const recentFails = (ip) => (fails.get(ip) || []).filter((t) => Date.now() - t < FAIL_WINDOW_MS);

// Same invite format the owner-only /join command accepts: the full
// chat.whatsapp.com link or the bare code.
const INVITE_RE = /(?:chat\.whatsapp\.com\/)?([a-zA-Z0-9]{20,24})/i;
const JOIN_WINDOW_MS = 60 * 60 * 1000;
const MAX_JOINS_PER_IP = 3;
const MAX_JOINS_PER_DAY = 30;
const MAX_CONCURRENT_JOINS = 3;
const joinHits = new Map();
let joinInFlight = 0;
let joinDay = { start: Date.now(), count: 0 };

// Guard for the public join page: a few requests an hour per visitor plus a
// hard daily ceiling overall, so nobody can walk the bot through group after
// group and get the WhatsApp number flagged.
function joinAllowed(ip) {
  const now = Date.now();
  if (now - joinDay.start > 24 * 60 * 60 * 1000) joinDay = { start: now, count: 0 };
  if (joinDay.count >= MAX_JOINS_PER_DAY) return false;
  const hits = (joinHits.get(ip) || []).filter((t) => now - t < JOIN_WINDOW_MS);
  if (hits.length >= MAX_JOINS_PER_IP) { joinHits.set(ip, hits); return false; }
  hits.push(now);
  joinHits.set(ip, hits);
  joinDay.count += 1;
  return true;
}

// Light limit for the name lookup so the join page can preview a group without
// burning the (much stricter) real-join allowance.
const infoHits = new Map();
function infoAllowed(ip) {
  const now = Date.now();
  const hits = (infoHits.get(ip) || []).filter((t) => now - t < 60 * 1000);
  if (hits.length >= 10) { infoHits.set(ip, hits); return false; }
  hits.push(now);
  infoHits.set(ip, hits);
  return true;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

function readJson(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (e) { reject(Object.assign(new Error('Invalid request body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// The bot's own WhatsApp number, so the status page can offer "message it
// yourself" as a second, human way to check it's alive alongside the
// automated indicator. Two env vars so no phone-number formatting logic is
// needed on either side: one for the wa.me link, one for display.
const contactDigits = () => (process.env.BOT_CONTACT_NUMBER || '2349063335551').replace(/[^\d]/g, '');
const contactDisplay = () => process.env.BOT_CONTACT_DISPLAY || '+234 906 333 5551';

function status() {
  const ex = (ctx.getStatus && ctx.getStatus()) || {};
  const q = ex.queue || {};
  // loggedOut comes straight from Baileys (DisconnectReason.loggedOut) - the
  // same real signal the console health monitor uses. It fires for an
  // account ban, but also a manual logout or a device removal - anything
  // that needs a fresh QR scan reads the same way to WhatsApp, so this is
  // the honest "something needs a human" state, not a certified ban detector.
  let health = 'smooth';
  if (ex.loggedOut) health = 'banned';
  else if (!ex.connected) health = 'offline';
  else if (lagMs > 1000 || (q.queued || 0) > 25) health = 'slow';
  return {
    health, uptimeSec: Math.round(process.uptime()), groups: ex.groupsCached || 0, commands: ex.commands || 0, lagMs,
    contactDigits: contactDigits(), contactDisplay: contactDisplay(),
  };
}

// Every group BlueHunter is in, filtered down to the ones `senderId` admins
// right now. This is the live source of truth - nothing about "your groups"
// is cached in the session beyond a short TTL, so a promotion shows up
// within a minute and a demotion is caught the moment that group is opened.
async function discoverGroups(senderId) {
  const all = await ctx.sock.groupFetchAllParticipating();
  const ids = Object.keys(all || {}).filter((k) => k && k.endsWith('@g.us'));
  const mine = [];
  for (const jid of ids) {
    try {
      const chat = await buildChatCompat(ctx.sock, jid);
      if (await isGroupAdmin(ctx.sock, chat, senderId)) {
        mine.push({ id: jid.replace('@g.us', ''), name: chat.name || jid.split('@')[0], members: chat.participants.length });
      }
    } catch (err) {
      // Fetch failed for this one group (rate limit, bot just left it) -
      // skip it rather than failing the whole scan.
    }
  }
  return mine;
}

async function myGroups(session, { force = false } = {}) {
  const fresh = session.groupsCache && Date.now() - session.groupsCache.at < GROUPS_CACHE_MS;
  if (!force && fresh) return session.groupsCache.list;
  const list = await discoverGroups(session.senderId);
  session.groupsCache = { at: Date.now(), list };
  return list;
}

// Re-checked on every request against live WhatsApp state - this is what
const normalizeId = (id) => String(id).split('@')[0].split(':')[0];

// WhatsApp can identify one person three ways: the id in the member list (often
// a hidden @lid), their phone jid, and the lid. Activity rows may be saved under
// any of them, so every lookup tries all three.
const idVariants = (p) => [p.id && p.id._serialized, p.jid, p.lid].filter(Boolean).map(normalizeId);
const phoneOf = (p) => {
  const j = [p.jid, p.id && p.id._serialized].find((x) => x && String(x).endsWith('@s.whatsapp.net'));
  return j ? '+' + normalizeId(j) : null;
};
const hiddenLabel = (p) => 'Hidden number ...' + normalizeId(idVariants(p)[0] || '0000').slice(-4);

// Builds id -> readable name for one group: saved display name first, then the
// phone number, then a short "Hidden number ...1234" tag. Never just "Member".
async function buildNamer(jid, chat) {
  const people = await Activity.find({ groupId: jid }).select('userId displayName').lean();
  const saved = new Map(people.filter((d) => d.displayName).map((d) => [normalizeId(d.userId), d.displayName]));
  const label = new Map();
  for (const p of chat.participants) {
    const name = idVariants(p).map((k) => saved.get(k)).find(Boolean) || phoneOf(p) || hiddenLabel(p);
    for (const k of idVariants(p)) label.set(k, name);
  }
  return (id) => {
    if (id === 'system') return 'Auto moderation';
    if (id === 'ai-moderation') return 'AI moderation';
    const n = normalizeId(id || '');
    return label.get(n) || saved.get(n) || (n ? 'Member ...' + n.slice(-4) : 'Unknown');
  };
}
const INACTIVE_DAYS = 14;
const DAILY_GRAPH_DAYS = 14;
const MAX_KICK_BATCH = 50;
// Anyone who joined in the last 24 hours is left out of the low-activity list
// and can't be removed from the dashboard: they haven't had a fair chance to talk.
const RECENT_JOIN_MS = 24 * 60 * 60 * 1000;
async function recentJoiners(jid) {
  const rows = await GroupMember.find({ groupId: jid, joinedAt: { $gte: new Date(Date.now() - RECENT_JOIN_MS) } }).select('userId').lean();
  return new Set(rows.map((r) => normalizeId(r.userId)));
}

// Whatever the group has set as its icon, or null if it never set one -
// Baileys throws in that case, which we just treat as "no photo".
async function groupPhoto(jid) {
  try { return (await ctx.sock.profilePictureUrl(jid, 'image')) || null; }
  catch (err) { return null; }
}

// Built entirely from Activity and GroupDailyActivity, which the bot already
// updates on every message (see events/message.js) - nothing here is sample
// data. The leaderboard and inactive count are scoped to people currently in
// the group, so someone who left doesn't linger at the top or count against
// "inactive". lowActivity additionally excludes current admins, since it
// feeds the dashboard's bulk-remove tool and admins shouldn't be a click
// away from getting kicked just for being quiet.
async function groupActivity(jid, chat) {
  const [docs, dayDocs, fresh] = await Promise.all([
    Activity.find({ groupId: jid }).select('userId displayName messageCount lastMessageAt').lean(),
    GroupDailyActivity.find({ groupId: jid }).select('date count').lean(),
    recentJoiners(jid),
  ]);
  const byNum = new Map(docs.map((d) => [normalizeId(d.userId), d]));
  const cutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;

  let totalMessages = 0;
  let inactiveMembers = 0;
  const tracked = [];
  const lowActivity = [];
  let recentCount = 0;
  for (const p of chat.participants) {
    const d = idVariants(p).map((k) => byNum.get(k)).find(Boolean);
    const messages = d ? d.messageCount || 0 : 0;
    if (idVariants(p).some((k) => fresh.has(k))) { recentCount += 1; if (d) { totalMessages += messages; tracked.push(d); } continue; }
    if (!d) inactiveMembers += 1;
    else {
      totalMessages += messages;
      tracked.push(d);
      if (new Date(d.lastMessageAt).getTime() < cutoff) inactiveMembers += 1;
    }
    if (!p.isAdmin && !p.isSuperAdmin) {
      const phone = phoneOf(p);
      lowActivity.push({
        id: p.id._serialized,
        name: (d && d.displayName) || phone || hiddenLabel(p),
        phone: d && d.displayName ? phone : null, // shown as a second line when we also know their name
        messages,
        last: d && d.lastMessageAt ? new Date(d.lastMessageAt).getTime() : null,
      });
    }
  }

  const leaderboard = tracked
    .slice()
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 10)
    .map((d) => ({ name: d.displayName || 'Member', messages: d.messageCount || 0 }));

  lowActivity.sort((a, b) => a.messages - b.messages);

  const byDate = new Map(dayDocs.map((d) => [d.date, d.count]));
  const daily = [];
  for (let i = DAILY_GRAPH_DAYS - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    daily.push({ date, count: byDate.get(date) || 0 });
  }
  const currentWeekMessages = daily.slice(-7).reduce((sum, day) => sum + day.count, 0);
  const previousWeekMessages = daily.slice(-14, -7).reduce((sum, day) => sum + day.count, 0);
  const weeklyChangePercent = previousWeekMessages
    ? Math.round(((currentWeekMessages - previousWeekMessages) / previousWeekMessages) * 100)
    : null;

  // How many current members were already quiet at the end of each day: those
  // with no tracked message at all, plus anyone whose last tracked message
  // predates that day. Real history from Activity.lastMessageAt, so the line
  // moves as people actually go quiet.
  const neverActive = chat.participants.length - tracked.length;
  const inactiveDaily = daily.map((d) => {
    const dayEnd = new Date(d.date + 'T23:59:59.999Z').getTime();
    let quiet = neverActive;
    for (const t of tracked) {
      if (!t.lastMessageAt || new Date(t.lastMessageAt).getTime() < dayEnd) quiet += 1;
    }
    return { date: d.date, count: quiet };
  });

  return { totalMessages, trackedMembers: tracked.length, inactiveMembers, recentJoiners: recentCount, inactiveDays: INACTIVE_DAYS, leaderboard, lowActivity, daily, inactiveDaily, currentWeekMessages, previousWeekMessages, weeklyChangePercent };
}

// Re-checked on every request against live WhatsApp state - this is what
// makes a demotion take effect immediately instead of waiting for the next
// login. Kicking the bot or removing the group has the same effect.


// ---- maintenance message ----
// A short notice the owner can post on the website ("Back at 9pm"). It is read on
// every status poll, so it is cached for a few seconds and refreshed on change.
let maintCache = { at: 0, value: null };
async function getMaintenance() {
  if (Date.now() - maintCache.at < 10000) return maintCache.value;
  let value = null;
  try {
    const doc = await SiteNotice.findOne({ key: 'maintenance', active: true }).lean();
    if (doc && doc.message) value = { message: doc.message, since: new Date(doc.updatedAt || Date.now()).getTime() };
  } catch (err) { value = maintCache.value; }
  maintCache = { at: Date.now(), value };
  return value;
}
async function setMaintenance(message, by) {
  const msg = String(message || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300);
  await SiteNotice.findOneAndUpdate({ key: 'maintenance' }, { $set: { message: msg, active: !!msg, updatedBy: by } }, { upsert: true });
  maintCache = { at: 0, value: null };
  return msg;
}

// ---- owner panel ----
// The owner is whoever isOwner() says it is (OWNER_NUMBER / OWNER_LID). The check
// also tries the number behind a hidden @lid id, so verifying inside a group works.
async function sessionIsOwner(session) {
  if (!session) return false;
  try {
    if (await isOwner(ctx.sock, session.senderId)) return true;
    const n = await resolveNumber(ctx.sock, session.senderId);
    return !!n && !!OWNER_NUMBER && n === String(OWNER_NUMBER).replace(/\D/g, '');
  } catch (err) { return false; }
}

let ownerGroupsCache = { at: 0, list: null };
async function ownerGroups(force) {
  if (!force && ownerGroupsCache.list && Date.now() - ownerGroupsCache.at < 30000) return ownerGroupsCache.list;
  const all = await ctx.sock.groupFetchAllParticipating();
  const metas = Object.values(all || {}).filter((m) => m && m.id && String(m.id).endsWith('@g.us'));
  const botIds = [ctx.sock.user && ctx.sock.user.id, ctx.sock.user && ctx.sock.user.lid].filter(Boolean).map(normalizeId);
  const keys = [];
  for (let i = 6; i >= 0; i--) keys.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const rows = await GroupDailyActivity.find({ groupId: { $in: metas.map((m) => m.id) }, date: { $in: keys } }).select('groupId date count').lean();
  const stats = new Map();
  for (const r of rows) {
    const e = stats.get(r.groupId) || { today: 0, week: 0 };
    e.week += r.count || 0;
    if (r.date === keys[keys.length - 1]) e.today = r.count || 0;
    stats.set(r.groupId, e);
  }
  const list = metas.map((m) => {
    const parts = m.participants || [];
    const self = parts.find((p) => [p.id, p.lid, p.jid].filter(Boolean).map(normalizeId).some((x) => botIds.includes(x)));
    const st = stats.get(m.id) || { today: 0, week: 0 };
    return { id: String(m.id).replace('@g.us', ''), name: m.subject || String(m.id).split('@')[0], members: parts.length, botAdmin: !!(self && self.admin), today: st.today, week: st.week };
  }).sort((a, b) => a.name.localeCompare(b.name));
  ownerGroupsCache = { at: Date.now(), list };
  return list;
}

async function requireAdmin(shortId, session) {
  const jid = `${shortId}@g.us`;
  let chat;
  try { chat = await buildChatCompat(ctx.sock, jid); }
  catch (err) { return { status: 404, error: 'BlueHunter is not in this group right now.' }; }
  if (!(await isGroupAdmin(ctx.sock, chat, session.senderId)) && !(await sessionIsOwner(session))) {
    return { status: 403, error: "You're not an admin of this group right now, so you can't change its settings." };
  }
  return { chat };
}

function cleanList(raw) {
  const words = String(raw).split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (words.length > 60) return { err: 'Extra blocked words: 60 words max' };
  for (const w of words) if (w.length > 40) return { err: `Extra blocked words: "${w}" is too long` };
  return { v: [...new Set(words)] };
}

function clean(key, v) {
  const r = RULES[key];
  if (!r) return { err: `Unknown setting: ${key}` };
  if (r.type === 'bool') return typeof v === 'boolean' ? { v } : { err: `${r.label} must be on or off` };
  if (r.type === 'choice') return r.options.includes(v) ? { v } : { err: `${r.label} has an invalid value` };
  if (r.type === 'list') return typeof v === 'string' ? cleanList(v) : { err: `${r.label} must be text` };
  if (r.type === 'number') return Number.isInteger(v) && v >= r.min && v <= r.max ? { v } : { err: `${r.label} must be a whole number from ${r.min} to ${r.max}` };
  if (r.type === 'time') {
    const t = typeof v === 'string' ? v.trim() : '';
    return t === '' || TIME_RE.test(t) ? { v: t } : { err: `${r.label} must be in HH:mm form, or blank` };
  }
  if (r.type === 'version') {
    const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
    return t === '' || /^[A-Z0-9]{2,10}$/.test(t) ? { v: t } : { err: `${r.label} must be 2 to 10 letters/numbers, or blank` };
  }
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length >= 1 && t.length <= 500 ? { v: t } : { err: `${r.label} must be 1 to 500 characters` };
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const get = req.method === 'GET';

  // Public homepage: paste an invite link and the bot joins. The admin
  // dashboard is at /dashboard (index.html still answers, for old links).
  if (get && (p === '/' || p === '/join')) return page(res, 'join.html');
  if (get && (p === '/dashboard' || p === '/index.html')) return page(res);
  if (!p.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

  if (!get) {
    if (!sameOrigin(req) || !(req.headers['content-type'] || '').includes('application/json')) return json(res, 403, { error: 'Request blocked' });
  }

  // Public: look up the group name behind an invite link so the page can say
  // "About to join <name>" before the real join. Does not join anything.
  if (req.method === 'POST' && p === '/api/bot-join-info') {
    const ip = clientIp(req);
    if (!infoAllowed(ip)) return json(res, 429, { error: 'Slow down a little. Try again in a minute.' });
    let body;
    try { body = await readJson(req); }
    catch (err) { return json(res, err.status || 400, { error: err.message || 'Invalid request.' }); }
    const m = INVITE_RE.exec(String(body.link || '').trim());
    if (!m) return json(res, 400, { error: "That doesn't look like a group invite link. It looks like https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv" });
    if (!ctx.sock) return json(res, 503, { error: 'BlueHunter is offline right now. Try again shortly.' });
    try {
      const info = await ctx.sock.groupGetInviteInfo(m[1]);
      return json(res, 200, { ok: true, groupName: (info && info.subject) || null });
    } catch (err) {
      return json(res, 400, { error: 'That invite link did not work. It may be invalid, expired or revoked.' });
    }
  }

  // Public: anyone with an invite link may ask BlueHunter to join a group.
  if (req.method === 'POST' && p === '/api/bot-join') {
    const ip = clientIp(req);
    if (!joinAllowed(ip)) return json(res, 429, { error: 'Too many join requests from here. Please try again later.' });
    let body;
    try { body = await readJson(req); }
    catch (err) { return json(res, err.status || 400, { error: err.message || 'Invalid request.' }); }

    const m = INVITE_RE.exec(String(body.link || '').trim());
    if (!m) return json(res, 400, { error: "That doesn't look like a group invite link. It looks like https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv" });
    const inviteCode = m[1];

    if (!ctx.sock) return json(res, 503, { error: 'BlueHunter is offline right now, so it cannot join anything. Try again shortly.' });
    if (joinInFlight >= MAX_CONCURRENT_JOINS) return json(res, 429, { error: 'BlueHunter is joining another group right now. Try again in a moment.' });

    joinInFlight += 1;
    try {
      let groupId;
      let inviteName = null;
      try { inviteName = ((await ctx.sock.groupGetInviteInfo(inviteCode)) || {}).subject || null; } catch (err) { /* optional */ }
      try {
        groupId = await ctx.sock.groupAcceptInvite(inviteCode);
      } catch (err) {
        const text = String(err.message || '');
        logger.warn(`bot-join: invite ${inviteCode} failed: ${text}`);
        if (/already/i.test(text)) return json(res, 200, { ok: true, alreadyIn: true, groupName: inviteName });
        if (/approval|request/i.test(text)) return json(res, 200, { ok: true, requested: true, groupName: inviteName });
        if (/not-authorized|forbidden|403|declin|reject|banned|removed/i.test(text)) return json(res, 403, { declined: true, groupName: inviteName, error: 'WhatsApp would not let BlueHunter in. The group may have declined it, or removed it before.' });
        if (/connect|closed|timed ?out|socket|stream/i.test(text)) return json(res, 503, { error: 'Lost contact with WhatsApp while joining. Try again in a moment.' });
        return json(res, 400, { error: 'That invite did not work. The link may be invalid, expired, or already used up.' });
      }

      // Groups that need admin approval: WhatsApp accepts the request but gives
      // no group id yet. The admin has to accept BlueHunter in the group.
      if (!groupId) return json(res, 200, { ok: true, requested: true, groupName: inviteName });

      // Never settle back into a group the bot was auto-removed from for a
      // real safety violation - leave again and say so.
      const existing = await GroupSettings.findOne({ groupId });
      if (existing?.autoLeftForSafety) {
        try { await ctx.sock.groupLeave(groupId); } catch (err) { /* best effort */ }
        return json(res, 403, { error: 'That group was previously removed for a safety policy violation, so BlueHunter left again. Ask the owner to clear the flag first.' });
      }

      markIntroduced(groupId); // so the participants-update handler does not send a second intro
      await GroupSettings.findOneAndUpdate({ groupId }, { introduced: true }, { upsert: true });
      try { await ctx.sock.sendMessage(groupId, { text: INTRO_MESSAGE }); } catch (err) { /* joined anyway */ }

      let groupName = null;
      try { groupName = (await ctx.sock.groupMetadata(groupId)).subject || null; } catch (err) { /* optional */ }
      return json(res, 200, { ok: true, groupName });
    } finally {
      joinInFlight -= 1;
    }
  }

  if (get && p === '/api/status') return json(res, 200, { ...status(), maintenance: await getMaintenance() });
  if (get && p === '/api/changelog') return json(res, 200, { entries: CHANGELOG });

  if (req.method === 'POST' && p === '/api/login') {
    const ip = clientIp(req);
    if (recentFails(ip).length >= MAX_FAILS) return json(res, 429, { error: 'Too many wrong codes. Try again in a few minutes.' });
    const body = await readJson(req);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const entry = codes.get(code);
    if (!entry || entry.expires < Date.now()) {
      fails.set(ip, [...recentFails(ip), Date.now()]);
      return json(res, 400, { error: 'That code is not valid or has expired. Send /verify in a group with BlueHunter for a new one.' });
    }
    codes.delete(code); // single use
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { expires: Date.now() + SESSION_TTL_MS, senderId: entry.senderId, groupsCache: null });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `bh_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
    return json(res, 200, { ok: true });
  }

  const session = getSession(req);

  if (req.method === 'POST' && p === '/api/logout') {
    sessions.delete(cookies(req).bh_session);
    res.setHeader('Set-Cookie', 'bh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (get && p === '/api/me') {
    if (!session) return json(res, 200, { signedIn: false, groups: [] });
    const owner = await sessionIsOwner(session);
    try {
      const groups = await myGroups(session, { force: url.searchParams.get('refresh') === '1' });
      return json(res, 200, { signedIn: true, owner, groups });
    } catch (err) {
      return json(res, 200, { signedIn: true, owner, groups: (session.groupsCache && session.groupsCache.list) || [], error: 'Could not refresh your groups right now.' });
    }
  }

  // Owner panel: every group the bot is in, with owner-only actions.
  if (p === '/api/owner/groups' || p === '/api/owner/maintenance' || /^\/api\/owner\/groups\/[0-9-]{5,40}\/(leave|message)$/.test(p)) {
    if (!session) return json(res, 401, { error: 'Sign in with a code first. Send /verify in a group with BlueHunter.' });
    if (!(await sessionIsOwner(session))) return json(res, 403, { error: 'Only the bot owner can use this.' });

    if (p === '/api/owner/maintenance') {
      if (get) { const m = await getMaintenance(); return json(res, 200, { message: m ? m.message : '', active: !!m }); }
      if (req.method === 'POST') {
        const body = await readJson(req);
        const raw = String(body.message || '');
        if (raw.length > 300) return json(res, 400, { error: 'Keep it under 300 characters.' });
        const msg = await setMaintenance(raw, normalizeId(session.senderId));
        logger.warn(msg ? `Owner posted a maintenance message: ${msg}` : 'Owner cleared the maintenance message');
        return json(res, 200, { ok: true, message: msg, active: !!msg });
      }
      return json(res, 404, { error: 'Not found.' });
    }

    if (get && p === '/api/owner/groups') {
      try {
        const groups = await ownerGroups(url.searchParams.get('refresh') === '1');
        return json(res, 200, { groups });
      } catch (err) { return json(res, 502, { error: 'Could not load the group list from WhatsApp right now. Try again in a moment.' }); }
    }

    const og = p.match(/^\/api\/owner\/groups\/([0-9-]{5,40})\/(leave|message)$/);
    if (og && req.method === 'POST') {
      const jid = `${og[1]}@g.us`;
      const body = await readJson(req);
      if (og[2] === 'leave') {
        if (body.confirm !== true) return json(res, 400, { error: 'Please confirm that you want the bot to leave.' });
        try { await ctx.sock.groupLeave(jid); }
        catch (err) { return json(res, 502, { error: 'WhatsApp would not let the bot leave right now. Try again in a moment.' }); }
        logger.warn(`Owner ${normalizeId(session.senderId)} made the bot leave ${jid} from the website`);
        ownerGroupsCache = { at: 0, list: null };
        return json(res, 200, { ok: true });
      }
      const text = String(body.text || '').trim();
      if (!text) return json(res, 400, { error: 'Write a message first.' });
      if (text.length > 1000) return json(res, 400, { error: 'That message is too long (1000 characters max).' });
      if (Date.now() - (session.lastOwnerMsg || 0) < 10000) return json(res, 429, { error: 'Wait a few seconds before sending another message.' });
      try { await ctx.sock.sendMessage(jid, { text: `📢 *Message from the owner*\n\n${text}` }); }
      catch (err) { return json(res, 502, { error: 'Could not send to that group. The bot may no longer be in it.' }); }
      session.lastOwnerMsg = Date.now();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found.' });
  }

  // Reminder posts: scheduled text / image / video posts for one group.
  const rpm = p.match(/^\/api\/groups\/([0-9-]{5,40})\/reminder-posts(?:\/([a-f0-9]{24}))?(?:\/(send|media))?$/);
  if (rpm) {
    if (!session) return json(res, 401, { error: 'Sign in with a code first. Send /verify in a group with BlueHunter.' });
    const jid = `${rpm[1]}@g.us`;
    const check = await requireAdmin(rpm[1], session);
    if (check.error) return json(res, check.status, { error: check.error });
    const rid = rpm[2];
    const action = rpm[3];
    const view = (d) => ({
      id: String(d._id), text: d.text || '', time: d.time, days: d.days || [], tagAll: !!d.tagAll, enabled: !!d.enabled,
      mediaType: d.mediaType || '', schedule: rp.describeSchedule(d), lastPostedDate: d.lastPostedDate || '',
    });
    // Shared by create and edit: returns { fields } or { err }.
    const readFields = (body, partial) => {
      const fields = {};
      if (!partial || body.text !== undefined) {
        const text = rp.cleanText(body.text);
        if (text.length > rp.MAX_TEXT) return { err: `Keep the text under ${rp.MAX_TEXT} characters.` };
        fields.text = text;
      }
      if (!partial || body.time !== undefined) {
        const t = rp.checkTime(body.time);
        if (t.err) return { err: t.err };
        fields.time = t.v;
      }
      if (!partial || body.days !== undefined) {
        const days = Array.isArray(body.days) ? body.days : [];
        if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { err: 'Days must be Sunday to Saturday.' };
        const uniq = [...new Set(days)].sort((a, b) => a - b);
        fields.days = uniq.length === 7 ? [] : uniq;
      }
      if (body.tagAll !== undefined) fields.tagAll = body.tagAll === true;
      if (body.enabled !== undefined) fields.enabled = body.enabled === true;
      return { fields };
    };
    const decodeMedia = (media) => {
      const raw = String((media && media.data) || '').replace(/^data:[^,]*,/, '');
      return Buffer.from(raw, 'base64');
    };

    try {
      if (get && !rid) {
        const docs = await ReminderPost.find({ groupId: jid }).sort({ createdAt: 1 });
        return json(res, 200, { posts: docs.map(view), max: rp.MAX_PER_GROUP, maxText: rp.MAX_TEXT });
      }

      if (get && rid && action === 'media') {
        const doc = await ReminderPost.findOne({ _id: rid, groupId: jid });
        if (!doc || !doc.mediaFile) return json(res, 404, { error: 'No media on this post.' });
        const buf = await rp.readMedia(doc.mediaFile);
        res.writeHead(200, { 'Content-Type': doc.mediaMime || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
        return res.end(buf);
      }

      if (req.method === 'POST' && !rid) {
        const body = await readJson(req, 18 * 1024 * 1024);
        if ((await rp.countForGroup(jid)) >= rp.MAX_PER_GROUP) return json(res, 400, { error: `This group already has ${rp.MAX_PER_GROUP} reminder posts. Remove one first.` });
        const r = readFields(body, false);
        if (r.err) return json(res, 400, { error: r.err });
        let media = {};
        if (body.media && body.media.data) {
          try { media = await rp.saveMedia(decodeMedia(body.media)); }
          catch (err) { return json(res, 400, { error: err.message }); }
        }
        if (!r.fields.text && !media.mediaFile) return json(res, 400, { error: 'Write some text or attach an image or video.' });
        const doc = await ReminderPost.create({ ...r.fields, ...media, groupId: jid, createdBy: session.senderId, enabled: r.fields.enabled !== false, lastPostedDate: rp.initialPostedDate(r.fields) });
        return json(res, 200, { ok: true, post: view(doc) });
      }

      if (rid) {
        const doc = await ReminderPost.findOne({ _id: rid, groupId: jid });
        if (!doc) return json(res, 404, { error: 'That reminder post no longer exists.' });

        if (req.method === 'DELETE') {
          await rp.deleteMedia(doc.mediaFile);
          await doc.deleteOne();
          return json(res, 200, { ok: true });
        }

        if (req.method === 'POST' && action === 'send') {
          if (Date.now() - (session.lastPostNow || 0) < 5000) return json(res, 429, { error: 'Wait a few seconds before posting again.' });
          session.lastPostNow = Date.now();
          try { await rp.sendPost(ctx.sock, doc); }
          catch (err) { return json(res, 502, { error: 'Could not post to the group: ' + err.message }); }
          return json(res, 200, { ok: true });
        }

        if (req.method === 'PATCH' && !action) {
          const body = await readJson(req, 18 * 1024 * 1024);
          const r = readFields(body, true);
          if (r.err) return json(res, 400, { error: r.err });
          let oldFile = '';
          if (body.media && body.media.data) {
            let media;
            try { media = await rp.saveMedia(decodeMedia(body.media)); }
            catch (err) { return json(res, 400, { error: err.message }); }
            oldFile = doc.mediaFile;
            Object.assign(doc, media);
          } else if (body.removeMedia === true && doc.mediaFile) {
            oldFile = doc.mediaFile;
            Object.assign(doc, { mediaFile: '', mediaType: '', mediaMime: '' });
          }
          Object.assign(doc, r.fields);
          if (!doc.text && !doc.mediaFile) return json(res, 400, { error: 'A reminder post needs text or an image or video.' });
          // A changed time or a re-enable follows the new schedule straight away (see initialPostedDate).
          if (r.fields.time !== undefined || r.fields.days !== undefined || r.fields.enabled === true) doc.lastPostedDate = rp.initialPostedDate(doc);
          await doc.save();
          if (oldFile) await rp.deleteMedia(oldFile);
          return json(res, 200, { ok: true, post: view(doc) });
        }
      }
    } catch (err) {
      return json(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong with that reminder post.' });
    }
    return json(res, 404, { error: 'Not found.' });
  }

  const m = p.match(/^\/api\/groups\/([0-9-]{5,40})$/);
  if (m) {
    if (!session) return json(res, 401, { error: 'Sign in with a code first. Send /verify in a group with BlueHunter.' });
    const jid = `${m[1]}@g.us`;
    const check = await requireAdmin(m[1], session);
    if (check.error) return json(res, check.status, { error: check.error });
    const pick = (doc) => Object.fromEntries(Object.keys(RULES).map((k) => [k, k === 'customBadwords' ? (doc[k] || []).join(', ') : doc[k]]));

    if (get) {
      const [doc, pfp, activity] = await Promise.all([GroupSettings.getOrCreate(jid), groupPhoto(jid), groupActivity(jid, check.chat)]);
      return json(res, 200, { id: m[1], name: check.chat.name || m[1], members: check.chat.participants.length, pfp, activity, values: pick(doc), schema: SCHEMA, actions: ACTIONS });
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const changes = {};
      for (const [k, v] of Object.entries(body.changes || {})) {
        const r = clean(k, v);
        if (r.err) return json(res, 400, { error: r.err });
        changes[k] = r.v;
      }
      if (!Object.keys(changes).length) return json(res, 400, { error: 'Nothing to save.' });
      const beforeSnap = await audit.snapshotSettings(jid);
      const doc = await GroupSettings.findOneAndUpdate({ groupId: jid }, { $set: changes }, { upsert: true, new: true });
      const labels = Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.label]));
      audit.logSettingsDiff({ groupId: jid, actorId: session.senderId, source: 'dashboard', before: beforeSnap, labels }).catch(() => {});
      const names = Object.keys(changes).map((k) => RULES[k].label);
      (async () => {
        try { await ctx.sock.sendMessage(jid, { text: `⚙️ An admin changed this group's settings on the web dashboard: ${names.join(', ')}.` }); } catch (e) { /* the save already worked */ }
      })();
      return json(res, 200, { ok: true, values: pick(doc) });
    }
  }


  // Live graph + deleted-message log for one group (admins only, re-checked
  // against WhatsApp on every request like everything else here).
  const sub = p.match(/^\/api\/groups\/([0-9-]{5,40})\/(live|admins|deleted-logs|deleted-media\/[A-Za-z0-9_-]{4,80})$/);
  if (sub && get) {
    if (!session) return json(res, 401, { error: 'Sign in with a code first. Send /verify in a group with BlueHunter.' });
    const jid = `${sub[1]}@g.us`;
    const check = await requireAdmin(sub[1], session);
    if (check.error) return json(res, check.status, { error: check.error });

    if (sub[2] === 'live') {
      const today = new Date().toISOString().slice(0, 10);
      const doc = await GroupDailyActivity.findOne({ groupId: jid, date: today }).select('count').lean();
      return json(res, 200, { now: Date.now(), minutes: live.series(jid, 61), today: doc ? doc.count : 0 });
    }

    // Owner + admins of this group, as JSON for the dashboard or as a download
    // (?format=csv or ?format=txt). Same admin-only check as everything else here.
    if (sub[2] === 'admins') {
      const chat = check.chat;
      const nameOf = await buildNamer(jid, chat);
      const rows = await Activity.find({ groupId: jid }).select('userId messageCount lastMessageAt').lean();
      const stat = new Map(rows.map((r) => [normalizeId(r.userId), r]));
      const botIds = [ctx.sock.user && ctx.sock.user.id, ctx.sock.user && ctx.sock.user.lid].filter(Boolean).map(normalizeId);
      const person = (pt, role) => {
        const d = idVariants(pt).map((k) => stat.get(k)).find(Boolean);
        const isBot = idVariants(pt).some((k) => botIds.includes(k));
        return {
          name: isBot ? 'BlueHunter' : nameOf(pt.id._serialized), phone: phoneOf(pt), role,
          isBot,
          messages: d ? d.messageCount || 0 : 0,
          lastActive: d && d.lastMessageAt ? new Date(d.lastMessageAt).getTime() : null,
        };
      };
      const byName = (a, b) => (a.isBot - b.isBot) || a.name.localeCompare(b.name); // the bot always last
      const owners = chat.participants.filter((x) => x.isSuperAdmin).map((x) => person(x, 'owner')).sort(byName);
      const admins = chat.participants.filter((x) => x.isAdmin && !x.isSuperAdmin).map((x) => person(x, 'admin')).sort(byName);
      const groupName = chat.name || sub[1];
      const format = url.searchParams.get('format');

      if (format === 'csv' || format === 'txt') {
        const slug = String(groupName).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'group';
        const day = new Date().toISOString().slice(0, 10);
        const all = [...owners, ...admins];
        let out;
        if (format === 'csv') {
          // names are typed by strangers: stop spreadsheets from running them as formulas
          const cell = (v) => { let t = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t) && !/^\+\d+$/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
          out = '\uFEFF' + ['Role,Name,Phone,Messages,Last active', ...all.map((a) => [a.role === 'owner' ? 'Owner' : 'Admin', a.name + (a.isBot ? ' (bot)' : ''), a.phone || '', a.messages, a.lastActive ? new Date(a.lastActive).toISOString() : ''].map(cell).join(','))].join('\r\n') + '\r\n';
        } else {
          const line = (a, i) => `${i + 1}. ${a.name}${a.isBot ? ' (bot)' : ''}${a.phone ? ' - ' + a.phone : ''}`;
          out = [`${groupName}`, `Owners and admins - exported ${day}`, '',
            owners.length ? `Owner${owners.length > 1 ? 's' : ''}:` : 'Owner: not visible to the bot', ...owners.map(line), '',
            `Admins (${admins.length}):`, ...(admins.length ? admins.map(line) : ['none']), ''].join('\r\n');
        }
        res.writeHead(200, {
          'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slug}-admins-${day}.${format}"`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        });
        return res.end(out);
      }
      return json(res, 200, { groupName, members: chat.participants.length, created: typeof chat.createdAt === 'number' ? chat.createdAt * 1000 : null, owners, admins });
    }

    // A deleted photo, video or voice note, straight from the bot's memory. Only
    // plain image/video/audio types are ever sent, never anything a browser would
    // run, and the file is looked up by message id inside this group only.
    if (sub[2].startsWith('deleted-media/')) {
      const mid = sub[2].slice(14);
      const e = (logsByGroup.get(jid) || []).find((x) => x.messageId === mid);
      if (!e || !e.mediaBuffer) return json(res, 404, { error: 'This media is no longer available.' });
      const SAFE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/3gpp', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/x-m4a']);
      const FALLBACK = { image: 'image/jpeg', sticker: 'image/webp', video: 'video/mp4', gif: 'video/mp4', audio: 'audio/ogg' };
      const declared = String(e.mediaMimeType || '').split(';')[0].trim().toLowerCase();
      const type = SAFE.has(declared) ? declared : FALLBACK[e.mediaType];
      if (!type) return json(res, 415, { error: 'This kind of file can\u2019t be previewed.' });
      const buf = e.mediaBuffer;
      const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        let start = m[1] ? parseInt(m[1], 10) : Math.max(0, buf.length - parseInt(m[2], 10));
        let end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), buf.length - 1) : buf.length - 1;
        if (start > end || start >= buf.length) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 });
        return res.end(buf.subarray(start, end + 1));
      }
      res.writeHead(200, { ...head, 'Content-Length': buf.length });
      return res.end(buf);
    }

    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 20));
    const entries = listDeletedLogs(jid, null, 1, limit);
    const total = getDeletedLogCount(jid, null);
    const who = await buildNamer(jid, check.chat);
    // The sender can be stored under a phone jid or a hidden @lid: if the first
    // form has no name, try every other form recorded for that message.
    const nameFor = (id, ids) => {
      const first = who(id);
      if (!/^Member \.\.\./.test(first) || !Array.isArray(ids)) return first;
      return ids.map(who).find((n) => !/^Member \.\.\./.test(n)) || first;
    };
    return json(res, 200, {
      total,
      ttlHours: Math.round(((DELETED_MESSAGE_LOG_TTL_MS || 6 * 3600000) / 3600000) * 10) / 10,
      entries: entries.map((e) => ({
        id: e.messageId,
        from: nameFor(e.userId, e.userIds),
        deletedBy: nameFor(e.deletedBy || e.userId, e.userIds),
        mediaUrl: e.mediaBuffer && e.mediaType && e.mediaType !== 'document' ? `/api/groups/${sub[1]}/deleted-media/${encodeURIComponent(e.messageId)}` : null,
        text: String(e.text || '').slice(0, 1000),
        mediaType: e.mediaType || null,
        sentAt: new Date(e.timestamp).getTime() || null,
        deletedAt: e.deletedAt || null,
      })),
    });
  }


  // Moderation log, settings history and AI-case evidence (admins only).
  const au = p.match(/^\/api\/groups\/([0-9-]{5,40})\/(audit|evidence\/[a-f0-9]{24})$/);
  if (au && get) {
    if (!session) return json(res, 401, { error: 'Sign in with a code first. Send /verify in a group with BlueHunter.' });
    const jid = `${au[1]}@g.us`;
    const check = await requireAdmin(au[1], session);
    if (check.error) return json(res, check.status, { error: check.error });

    // A saved screenshot or thumbnail from an AI-moderation case. The browser
    // only sends the case id; the file path always comes from the database and
    // must sit inside the evidence folder.
    if (au[2].startsWith('evidence/')) {
      const w = await Warning.findOne({ _id: au[2].slice(9), groupId: jid }).select('evidencePath').lean();
      const file = w && w.evidencePath ? path.resolve(w.evidencePath) : '';
      if (!file || !file.startsWith(EVIDENCE_DIR + path.sep) || !fs.existsSync(file)) return json(res, 404, { error: 'No evidence file saved for this case.' });
      const buf = fs.readFileSync(file);
      const type = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : null;
      if (!type || buf.length > 8 * 1024 * 1024) return json(res, 415, { error: 'That evidence file cannot be shown.' });
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    }

    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 30));
    const before = new Date(Number(url.searchParams.get('before')) || Date.now() + 1000);
    const nameOf = await buildNamer(jid, check.chat);
    const clip = (t, n) => (String(t || '').length > n ? String(t).slice(0, n - 1) + '\u2026' : String(t || ''));
    const view = url.searchParams.get('view') === 'settings' ? 'settings' : 'actions';
    let rows = [];

    if (view === 'settings') {
      const docs = await AuditLog.find({ groupId: jid, category: 'settings', createdAt: { $lt: before } }).sort({ createdAt: -1 }).limit(limit + 1).lean();
      rows = docs.map((d) => ({
        id: String(d._id), at: new Date(d.createdAt).getTime(), kind: d.type, actor: nameOf(d.actorId), source: d.source, command: d.command,
        changes: (d.details && d.details.changes) || null, text: (d.details && d.details.text) || '',
      }));
    } else {
      const type = ['all', 'warn', 'ai', 'mute', 'kick', 'ban'].includes(url.searchParams.get('type')) ? url.searchParams.get('type') : 'all';
      const auditTypes = { all: ['mute', 'unmute', 'kick', 'ban', 'unban', 'resetwarn'], warn: ['resetwarn'], mute: ['mute', 'unmute'], kick: ['kick'], ban: ['ban', 'unban'], ai: [] }[type];
      const wq = { groupId: jid, createdAt: { $lt: before } };
      if (type === 'ai') wq.source = 'ai'; else if (type === 'warn') wq.source = { $ne: 'ai' };
      const [warns, acts] = await Promise.all([
        ['all', 'warn', 'ai'].includes(type) ? Warning.find(wq).sort({ createdAt: -1 }).limit(limit + 1).lean() : [],
        auditTypes.length ? AuditLog.find({ groupId: jid, category: 'action', type: { $in: auditTypes }, createdAt: { $lt: before } }).sort({ createdAt: -1 }).limit(limit + 1).lean() : [],
      ]);
      const wrows = warns.map((w) => {
        const ai = w.source === 'ai';
        const hasImg = !!(w.evidencePath && ['image', 'video', 'sticker'].includes(w.evidenceType) && path.resolve(w.evidencePath).startsWith(EVIDENCE_DIR + path.sep) && fs.existsSync(w.evidencePath));
        return {
          id: 'w' + w._id, at: new Date(w.createdAt).getTime(), kind: ai ? 'ai' : w.moderatorId === 'system' ? 'strike' : 'warn',
          target: nameOf(w.userId), actor: nameOf(w.moderatorId), source: 'auto', reason: w.reason,
          evidence: ai ? { type: w.evidenceType, text: clip(w.evidenceText, 600), image: hasImg ? `/api/groups/${au[1]}/evidence/${w._id}` : null } : null,
        };
      });
      const arows = acts.map((d) => ({
        id: String(d._id), at: new Date(d.createdAt).getTime(), kind: d.type, target: nameOf(d.targetId), actor: nameOf(d.actorId),
        source: d.source, command: d.command, reason: d.reason,
        until: d.type === 'mute' && d.details ? d.details.until || null : null, count: d.type === 'resetwarn' && d.details ? d.details.count : null,
      }));
      rows = [...wrows, ...arows].sort((a, b) => b.at - a.at);
    }
    const more = rows.length > limit;
    rows = rows.slice(0, limit);
    return json(res, 200, { rows, more, next: rows.length ? rows[rows.length - 1].at : null });
  }

  const km = p.match(/^\/api\/groups\/([0-9-]{5,40})\/kick$/);
  if (km && req.method === 'POST') {
    if (!session) return json(res, 401, { error: 'Sign in with a code first. Send /verify in a group with BlueHunter.' });
    const jid = `${km[1]}@g.us`;
    const check = await requireAdmin(km[1], session);
    if (check.error) return json(res, check.status, { error: check.error });
    const body = await readJson(req);
    const requested = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!requested.length) return json(res, 400, { error: 'Pick at least one member to remove.' });
    if (requested.length > MAX_KICK_BATCH) return json(res, 400, { error: `Remove at most ${MAX_KICK_BATCH} members at a time.` });
    // Never trust the id list the browser sent on its own - only ever remove
    // people who are actually current, non-admin participants right now.
    const removable = new Set(check.chat.participants.filter((p) => !p.isAdmin && !p.isSuperAdmin).map((p) => p.id._serialized));
    const fresh = await recentJoiners(jid);
    const byId = new Map(check.chat.participants.map((p) => [p.id._serialized, p]));
    const isFresh = (id) => { const p = byId.get(id); return !!p && idVariants(p).some((k) => fresh.has(k)); };
    const ids = requested.filter((id) => removable.has(id) && !isFresh(id));
    if (!ids.length) return json(res, 400, { error: requested.some(isFresh) ? 'Members who joined in the last 24 hours can\u2019t be removed yet.' : 'None of those are removable members of this group right now.' });
    try {
      await audit.runAs({ actorId: session.senderId, source: 'dashboard', reason: 'Removed for low activity' }, () => check.chat.removeParticipants(ids));
    } catch (err) {
      return json(res, 502, { error: "Couldn't remove them - make sure BlueHunter is still an admin of this group." });
    }
    (async () => {
      try { await ctx.sock.sendMessage(jid, { text: `\u{1F9F9} An admin removed ${ids.length} low-activity member${ids.length === 1 ? '' : 's'} from the web dashboard.` }); } catch (e) { /* the removal already worked */ }
    })();
    return json(res, 200, { ok: true, removed: ids.length });
  }

  return json(res, 404, { error: 'Not found' });
}

function startWebServer({ sock, getStatus }) {
  if (!webEnabled()) return logger.info('Web dashboard is off (WEB_ENABLED=false).');
  ctx = { sock, getStatus };
  live.install();
  let last = Date.now();
  setInterval(() => { const now = Date.now(); lagMs = Math.max(0, now - last - 1000); last = now; }, 1000).unref();
  setInterval(() => {
    const now = Date.now();
    for (const [c, e] of codes) if (e.expires < now) codes.delete(c);
    for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
    for (const ip of fails.keys()) if (!recentFails(ip).length) fails.delete(ip);
  }, 60_000).unref();

  const port = Number(process.env.WEB_PORT || process.env.SERVER_PORT || process.env.PORT || 3000);
  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (!err.status) logger.error(`Web request failed: ${err.message}`);
      if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
    });
  });
  server.on('error', (err) => logger.error(`Web dashboard could not start on port ${port}: ${err.code === 'EADDRINUSE' ? 'port already in use' : err.message}`));
  server.listen(port, '0.0.0.0', () => logger.info(`Web dashboard listening on port ${port}`));
}

module.exports = { startWebServer, issueCode, webEnabled, webUrl };
