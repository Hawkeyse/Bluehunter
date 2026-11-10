/**
 * Tiny concurrency limiter for incoming-message handling.
 *
 * Without a cap, every incoming message starts its own full pipeline
 * immediately (Mongo lookups, an OpenAI moderation call, media downloads,
 * command execution). When lots of groups are active at once, all of that
 * stacks up simultaneously - memory, sockets and Mongo connections spike
 * together. Here at most `concurrency` messages are being processed at a
 * time and the rest wait their turn in order.
 *
 * `taskTimeoutMs` frees the slot if one message hangs (a stalled download,
 * a dead socket) so a single stuck task can never jam the whole queue. The
 * stuck task itself isn't killed - it just stops blocking everyone else.
 */
function createLimiter({ concurrency = 10, taskTimeoutMs = 90_000, onError, onTimeout } = {}) {
  let active = 0;
  let timedOut = 0;
  const queue = [];

  function pump() {
    while (active < concurrency && queue.length > 0) {
      const { fn, resolve } = queue.shift();
      active += 1;
      let finished = false;

      const finish = (didTimeOut) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        active -= 1;
        if (didTimeOut) {
          timedOut += 1;
          if (onTimeout) onTimeout();
        }
        resolve();
        pump();
      };

      const timer = setTimeout(() => finish(true), taskTimeoutMs);

      Promise.resolve()
        .then(fn)
        .catch((err) => {
          if (onError) onError(err);
        })
        .finally(() => finish(false));
    }
  }

  function run(fn) {
    return new Promise((resolve) => {
      queue.push({ fn, resolve });
      pump();
    });
  }

  /**
   * Like run(), but hands back whatever the task returns and rethrows
   * whatever it throws, so the caller's own try/catch still works. Waits its
   * turn exactly like run() does.
   */
  function exec(fn) {
    return new Promise((resolve, reject) => {
      run(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  function stats() {
    return { active, queued: queue.length, timedOut, concurrency };
  }

  return { run, exec, stats };
}

module.exports = { createLimiter };
