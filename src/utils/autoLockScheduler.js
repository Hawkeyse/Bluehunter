const GroupSettings = require('../models/GroupSettings');
const { COUNTRY_OFFSETS } = require('./countryOffsets');
const { getGroupMetadataCached } = require('./waCompat');
const { correctedNow } = require('./serverClock');
const { AUTO_LOCK_CHECK_INTERVAL_MS } = require('../config');
const logger = require('./logger');

const WARN_MINUTES_BEFORE = 5;

const closeWarnText = (name) => `⏳ *${name}* will be locked in 5 minutes. Please finish your conversations.`;
const closeText = (name) => `🔒 *${name}* is now locked. Messaging has been disabled. Only admins can send messages.`;
const openWarnText = (name) => `⏳ *${name}* will be unlocked in 5 minutes.`;
const openText = (name) => `🔓 *${name}* is now open. Members can send messages again.`;

function offsetForZone(zone) {
  if (zone === 'utc') return 0;
  return COUNTRY_OFFSETS[zone]; // undefined if not a recognized country
}

/** "HH:mm" -> minutes since midnight, or null if malformed. */
function parseTimeToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/** Converts a local HH:mm (in a zone with the given UTC offset) to UTC minutes-since-midnight. */
function localMinutesToUtcMinutes(localMinutes, offsetHours) {
  return ((localMinutes - offsetHours * 60) % 1440 + 1440) % 1440;
}

function todayUtcDateKey(now) {
  return now.toISOString().slice(0, 10);
}

async function sendToGroup(sock, groupId, textBuilder) {
  const metadata = await getGroupMetadataCached(sock, groupId);
  const name = metadata?.subject || 'This group';
  await sock.sendMessage(groupId, { text: textBuilder(name) });
}

function startAutoLockScheduler(sock) {
  // Same overlap guard as autoGreetingScheduler.js - see the comment there.
  let tickInProgress = false;

  setInterval(async () => {
    if (tickInProgress) {
      logger.warn('Auto-lock scheduler: previous tick still running, skipping this interval.');
      return;
    }
    tickInProgress = true;
    try {
      const now = correctedNow();
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const dateKey = todayUtcDateKey(now);

      const groups = await GroupSettings.find({ scheduledLockEnabled: true });
      for (const group of groups) {
        try {
          const offset = offsetForZone(group.scheduledLockZone);
          if (offset === undefined) continue; // invalid/unset zone

          const closeLocalMinutes = parseTimeToMinutes(group.scheduledCloseTime);
          const openLocalMinutes = parseTimeToMinutes(group.scheduledOpenTime);

          // --- 5-minute pre-close warning ---
          if (closeLocalMinutes !== null && group.lastScheduledCloseWarnDate !== dateKey) {
            const closeUtcMinutes = localMinutesToUtcMinutes(closeLocalMinutes, offset);
            const warnUtcMinutes = ((closeUtcMinutes - WARN_MINUTES_BEFORE) % 1440 + 1440) % 1440;
            if (warnUtcMinutes === nowMinutes) {
              await sendToGroup(sock, group.groupId, closeWarnText);
              group.lastScheduledCloseWarnDate = dateKey;
              await group.save();
            }
          }

          // --- close ---
          if (closeLocalMinutes !== null && group.lastScheduledCloseDate !== dateKey) {
            const closeUtcMinutes = localMinutesToUtcMinutes(closeLocalMinutes, offset);
            if (closeUtcMinutes === nowMinutes) {
              await sock.groupSettingUpdate(group.groupId, 'announcement');
              await sendToGroup(sock, group.groupId, closeText);
              group.isOpen = false;
              group.lastScheduledCloseDate = dateKey;
              await group.save();
            }
          }

          // --- 5-minute pre-open warning ---
          if (openLocalMinutes !== null && group.lastScheduledOpenWarnDate !== dateKey) {
            const openUtcMinutesForWarn = localMinutesToUtcMinutes(openLocalMinutes, offset);
            const warnUtcMinutes = ((openUtcMinutesForWarn - WARN_MINUTES_BEFORE) % 1440 + 1440) % 1440;
            if (warnUtcMinutes === nowMinutes) {
              await sendToGroup(sock, group.groupId, openWarnText);
              group.lastScheduledOpenWarnDate = dateKey;
              await group.save();
            }
          }

          // --- open ---
          if (openLocalMinutes !== null && group.lastScheduledOpenDate !== dateKey) {
            const openUtcMinutes = localMinutesToUtcMinutes(openLocalMinutes, offset);
            if (openUtcMinutes === nowMinutes) {
              await sock.groupSettingUpdate(group.groupId, 'not_announcement');
              await sendToGroup(sock, group.groupId, openText);
              group.isOpen = true;
              group.lastScheduledOpenDate = dateKey;
              await group.save();
            }
          }
        } catch (err) {
          logger.warn('Auto-lock scheduler failed for group', group.groupId, '-', err.message);
        }
      }
    } catch (err) {
      logger.error('Auto-lock scheduler error:', err.message);
    } finally {
      tickInProgress = false;
    }
  }, AUTO_LOCK_CHECK_INTERVAL_MS);
}

module.exports = { startAutoLockScheduler };