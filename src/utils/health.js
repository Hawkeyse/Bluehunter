const fs = require('fs');
const logger = require('./logger');
const { drainCounters } = require('./consoleFilter');

const MB = 1024 * 1024;

/** Container memory limit in bytes (cgroup v2, then v1), or null if there isn't a real one. */
function readMemoryLimit() {
  const candidates = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0 && value < 64 * 1024 * MB) return value;
    } catch (err) {
      // not present on this host - try the next one
    }
  }
  return null;
}

/**
 * Periodic health line + early-warning alerts, written to bluehunter.log.
 *
 * Why this exists: when a host kills a Node process for running out of
 * memory (or the process wedges), nothing is printed at all - the console
 * just goes quiet and you have to restart. With this running you get:
 *   - a [HEALTH] line every few minutes (memory, event-loop lag, queue depth)
 *   - a [WARN] the moment memory passes 80% of the container limit, the event
 *     loop stalls for 2s+, or the message queue backs up
 * so the last lines before a silent stop show what was going on.
 */
function startHealthMonitor({ getExtra, reportEveryMs = 5 * 60_000 } = {}) {
  const memLimit = readMemoryLimit();

  let lastTick = Date.now();
  let maxLagMs = 0;
  setInterval(() => {
    const now = Date.now();
    maxLagMs = Math.max(maxLagMs, Math.max(0, now - lastTick - 1000));
    lastTick = now;
  }, 1000).unref();

  const lastWarnAt = {};
  function warnOnce(key, text) {
    const now = Date.now();
    if (now - (lastWarnAt[key] || 0) < 5 * 60_000) return;
    lastWarnAt[key] = now;
    logger.warn(`[HEALTH] ${text}`);
  }

  let lastReportAt = 0;
  setInterval(() => {
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / MB);
    const heapMb = Math.round(mem.heapUsed / MB);
    const extra = getExtra ? getExtra() : {};
    const queue = extra.queue || { active: 0, queued: 0, timedOut: 0 };
    const signal = drainCounters();

    if (memLimit && mem.rss / memLimit >= 0.8) {
      warnOnce('mem', `memory at ${Math.round((mem.rss / memLimit) * 100)}% of the ${Math.round(memLimit / MB)}MB container limit (rss=${rssMb}MB) - the host will kill the process if this keeps climbing.`);
    }
    if (maxLagMs >= 2000) {
      warnOnce('lag', `event loop was blocked for ~${Math.round(maxLagMs)}ms - something is doing heavy synchronous work.`);
    }
    if (queue.queued >= 20) {
      warnOnce('queue', `${queue.queued} messages are waiting in the queue (${queue.active} processing) - the bot is falling behind.`);
    }
    if (signal.badMac >= 25) {
      warnOnce('signal', `${signal.badMac} "Bad MAC" decrypt failures in the last minute - if this keeps happening the saved session is out of sync. Stop the bot, delete the .baileys_auth folder and re-scan.`);
    }

    const now = Date.now();
    if (now - lastReportAt >= reportEveryMs) {
      lastReportAt = now;
      logger.info(
        `[HEALTH] rss=${rssMb}MB${memLimit ? `/${Math.round(memLimit / MB)}MB` : ''} heap=${heapMb}MB ` +
          `loopLagMax=${Math.round(maxLagMs)}ms queue=${queue.active}active/${queue.queued}waiting timedOut=${queue.timedOut} ` +
          `socket=${extra.connected ? 'up' : extra.loggedOut ? 'LOGGED-OUT (needs re-scan)' : 'DOWN'} groupsCached=${extra.groupsCached ?? '?'} ` +
          `decryptFail(1m)=${signal.decryptFailures}`
      );
    }
    maxLagMs = 0;
  }, 60_000).unref();
}

module.exports = { startHealthMonitor };
