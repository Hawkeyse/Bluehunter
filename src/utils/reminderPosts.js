const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ReminderPost = require('../models/ReminderPost');
const { getGroupMetadataCached } = require('./waCompat');
const { correctedNow } = require('./serverClock');

// Lives next to moderation-evidence/, outside src/, so deploys that replace
// src/ never wipe uploaded media.
const MEDIA_DIR = path.resolve(path.join(__dirname, '..', '..', 'reminder-media'));
const MAX_PER_GROUP = 10;
const MAX_TEXT = 1500;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const CATCHUP_MINUTES = 20; // if the bot was briefly down at post time, still post up to this late
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Exact 3-letter names only (plus tues/thur/thurs) - full words like "Monday" are left alone so a message that
// starts with one isn't mistaken for the day list.
const DAY_ALIASES = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

/** "daily" -> [], "mon,thu" -> [1,4], "weekdays" -> [1..5]. null = not a valid day list. */
function parseDays(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t || t === 'daily' || t === 'everyday' || t === 'every') return [];
  if (t === 'weekdays') return [1, 2, 3, 4, 5];
  if (t === 'weekends') return [0, 6];
  const out = new Set();
  for (const part of t.split(/[,\s]+/).filter(Boolean)) {
    const i = DAY_ALIASES[part];
    if (i === undefined) return null;
    out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** True when a command word is meant as the day list (so the rest is the text). */
function isDaysToken(tok) {
  const t = String(tok || '').trim();
  return t !== '' && parseDays(t) !== null;
}

function describeSchedule(post) {
  const days = post.days && post.days.length && post.days.length < 7 ? post.days.map((d) => DAY_LABELS[d]).join(', ') : 'Every day';
  return `${days} at ${post.time} UTC`;
}

function detectMedia(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { type: 'image', mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { type: 'image', mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(4, 8).toString() === 'ftyp') return { type: 'video', mime: 'video/mp4', ext: 'mp4' };
  return null;
}

async function saveMedia(buf) {
  if (buf.length > MAX_MEDIA_BYTES) throw new Error('That file is too big (12 MB max).');
  const kind = detectMedia(buf);
  if (!kind) throw new Error('Only JPG, PNG, WEBP images and MP4 videos are supported.');
  await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.${kind.ext}`;
  await fs.promises.writeFile(path.join(MEDIA_DIR, file), buf);
  return { mediaFile: file, mediaType: kind.type, mediaMime: kind.mime };
}

const safePath = (file) => path.join(MEDIA_DIR, path.basename(String(file || '')));
const deleteMedia = (file) => (file ? fs.promises.unlink(safePath(file)).catch(() => {}) : Promise.resolve());
const readMedia = (file) => fs.promises.readFile(safePath(file));

const cleanText = (raw) => String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim();

/** { v } or { err } for a "HH:mm" UTC string. */
function checkTime(raw) {
  const t = String(raw || '').trim();
  return TIME_RE.test(t) ? { v: t } : { err: 'Time must be 24-hour HH:mm in UTC, e.g. 16:00.' };
}

function isDue(post, now) {
  if (post.days && post.days.length && !post.days.includes(now.getUTCDay())) return false;
  const m = TIME_RE.exec(post.time || '');
  if (!m) return false;
  const target = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const diff = now.getUTCHours() * 60 + now.getUTCMinutes() - target;
  return diff >= 0 && diff <= CATCHUP_MINUTES;
}

/**
 * Value for lastPostedDate when a post is created, enabled or rescheduled:
 * if its time already passed a few minutes ago today, treat today as done so
 * it starts from the next scheduled day instead of firing the moment it is saved.
 */
function initialPostedDate(fields) {
  const now = correctedNow();
  return isDue(fields, now) ? now.toISOString().slice(0, 10) : '';
}

async function sendPost(sock, post) {
  const text = post.text || '';
  let mentions = [];
  if (post.tagAll) {
    const metadata = await getGroupMetadataCached(sock, post.groupId);
    mentions = (metadata?.participants || []).map((p) => p.id);
  }
  const extra = mentions.length ? { mentions } : {};
  if (post.mediaFile) {
    const buffer = await readMedia(post.mediaFile);
    const content = post.mediaType === 'video' ? { video: buffer, mimetype: post.mediaMime || 'video/mp4' } : { image: buffer };
    if (text) content.caption = text;
    return sock.sendMessage(post.groupId, { ...content, ...extra });
  }
  if (!text) throw new Error('This reminder post has no text and no media.');
  return sock.sendMessage(post.groupId, { text, ...extra });
}

const countForGroup = (groupId) => ReminderPost.countDocuments({ groupId });

module.exports = {
  MEDIA_DIR, MAX_PER_GROUP, MAX_TEXT, MAX_MEDIA_BYTES, CATCHUP_MINUTES, DAY_LABELS,
  parseDays, isDaysToken, describeSchedule, detectMedia, saveMedia, deleteMedia, readMedia,
  cleanText, checkTime, isDue, initialPostedDate, sendPost, countForGroup, safePath,
};
