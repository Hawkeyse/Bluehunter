// Who did what in a group: moderation actions and settings changes.
//
// Context travels with AsyncLocalStorage: the command handler (and the web
// dashboard) wrap their work in runAs({ actorId, source, ... }), and the shared
// stores (muteStore, banStore, warnStore, waCompat) read it when they log.
// Anything that runs outside a wrapper is recorded as automatic.
const { AsyncLocalStorage } = require('async_hooks');
const AuditLog = require('../models/AuditLog');
const GroupSettings = require('../models/GroupSettings');
const logger = require('./logger');

const als = new AsyncLocalStorage();
const runAs = (ctx, fn) => als.run(ctx, fn);
const current = () => als.getStore() || null;

function log(entry) {
  const c = current() || {};
  const row = {
    actorId: c.actorId || 'system',
    source: c.source || 'auto',
    command: c.command || '',
    ...entry,
  };
  if (!entry.reason && c.reason) row.reason = c.reason;
  // Fire and forget: logging must never break moderation.
  AuditLog.create(row).catch((err) => logger.warn(`audit log write failed: ${err.message}`));
}

const logAction = (type, groupId, targetId, extra = {}) => log({ category: 'action', type, groupId, targetId, ...extra });

// ---- settings diff ----
const IGNORE = /^(_id|__v|groupId|createdAt|updatedAt|introduced|autoLeft.*|lastActivityAt|last[A-Z].*|recentMessageTimestamps)$/;
const LABELS = {
  isOpen: 'Chat open to everyone', isLocked: 'Group info locked to admins', antilinkWhitelist: 'Allowed links',
  filterBadwords: 'Bad word filter', customBadwords: 'Extra blocked words', aiChatEnabled: 'AI chat',
  aiModerationEnabled: 'AI moderation', badwordsAction: 'Bad word filter action', welcomeEnabled: 'Welcome new members',
  goodbyeEnabled: 'Say goodbye', autoGreetingsEnabled: 'Daily greetings', scheduledLockEnabled: 'Auto close/open',
  bibleEnabled: 'Daily Bible verse', bibleVerseDetectEnabled: 'Detect verse references', jokesEnabled: 'Daily joke',
  nsfwAllowed: 'Adult content allowed',
  antilink: 'Block links', antispam: 'Block spam', antiflood: 'Block flooding', antiforward: 'Block forwarded messages',
  antiraid: 'Raid lockdown', antigroupstatus: 'Block group-status posts', antiviewonce: 'Reveal view-once media',
  antilinkAction: 'Block links: action', antispamAction: 'Block spam: action', antifloodAction: 'Block flooding: action',
  antiforwardAction: 'Block forwarded messages: action', autoreply: 'Auto replies', silent: 'Silent mode', prefix: 'Command prefix',
  scheduledCloseTime: 'Close time', scheduledOpenTime: 'Open time', scheduledLockZone: 'Close/open time zone',
  bibleTime: 'Verse time (UTC)', bibleVersion: 'Bible translation', jokesType: 'Joke type', jokesTime: 'Joke time (UTC)',
  autoGreetingsCountry: 'Greetings country', welcomeMessage: 'Welcome message', goodbyeMessage: 'Goodbye message',
};
const pretty = (k) => LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

function plain(doc) {
  const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc || {};
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (IGNORE.test(k) || v instanceof Map) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
const show = (v) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : Array.isArray(v) ? v.join(', ') : v == null || v === '' ? '(blank)' : String(v));
const clip = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + '\u2026' : s);

async function snapshotSettings(groupId) {
  try { return plain(await GroupSettings.findOne({ groupId }).lean()); } catch (e) { return null; }
}

function diffSettings(before, after, labels = {}) {
  const changes = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    changes.push({ key: k, label: labels[k] || pretty(k), from: clip(show(before[k])), to: clip(show(after[k])) });
  }
  return changes;
}

async function logSettingsDiff({ groupId, actorId, source, command = '', before, labels }) {
  if (!before) return;
  const after = await snapshotSettings(groupId);
  if (!after) return;
  const changes = diffSettings(before, after, labels);
  if (!changes.length) return;
  AuditLog.create({ groupId, category: 'settings', type: 'setting', actorId, source, command, details: { changes } })
    .catch((err) => logger.warn(`audit log write failed: ${err.message}`));
}

// Group changes that are not settings (names, admins). Recorded after the command runs.
const GROUP_CHANGE_COMMANDS = new Set(['promote', 'demote', 'setname', 'setdesc', 'setpfp']);
function logGroupCommand({ groupId, actorId, command, args }) {
  if (!GROUP_CHANGE_COMMANDS.has(command)) return;
  AuditLog.create({
    groupId, category: 'settings', type: 'admin_cmd', actorId, source: 'command', command,
    details: { text: clip((args || []).join(' '), 100) },
  }).catch(() => {});
}

module.exports = { runAs, current, log, logAction, snapshotSettings, logSettingsDiff, logGroupCommand, pretty };
