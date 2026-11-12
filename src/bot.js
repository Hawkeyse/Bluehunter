// Must be first: swallows libsignal's console spam ("Bad MAC", "Closing session"
// dumps with private keys) before anything can print it. See utils/consoleFilter.js.
require('./utils/consoleFilter').install();

const fs = require('fs');
const path = require('path');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const connectDB = require('./database/connect');
const { loadCommands } = require('./handlers/commandHandler');
const { SESSION_PATH, BOT_NAME, SEND_GAP_MS, PAIRING_NUMBER, AUTO_RELINK } = require('./config');
const logger = require('./utils/logger');
const { peekGroupMetadata, invalidateGroupMetadata, groupMetadataCacheSize } = require('./utils/waCompat');
const { startHealthMonitor } = require('./utils/health');
const { startWebServer, invalidateGroupCaches } = require('./web/server');
const { startMemorySweeper } = require('./utils/sweeper');
const { trackIncomingMessage, handleDeleteEvent, handleMessageUpdates, startDeletedLogPruner } = require('./utils/deletedLogs');

const registerReadyEvent = require('./events/ready');
const registerMessageEvent = require('./events/message');
const registerGroupParticipantsEvent = require('./events/group_participants');
const { startReminderScheduler } = require('./utils/reminderScheduler');
const { startGroupActivityScheduler } = require('./utils/groupActivityScheduler');
const { startAutoGreetingScheduler } = require('./utils/autoGreetingScheduler');
const { startAutoLockScheduler } = require('./utils/autoLockScheduler');
const { startTimedLockScheduler } = require('./utils/timedLockScheduler');
const { startBibleScheduler } = require('./utils/bibleScheduler');
const { startJokeScheduler } = require('./utils/jokeScheduler');
const { startAutoKickScheduler } = require('./utils/autoKickScheduler');
const { startReminderPostScheduler } = require('./utils/reminderPostScheduler');
const { startYoutubeAlertScheduler } = require('./utils/youtubeAlertScheduler');
const { startXAlertScheduler } = require('./utils/xAlertScheduler');

// Lives outside start() (which runs again on every reconnect) so the backoff
// below actually grows across attempts instead of resetting.
let consecutiveFailures = 0;
let reconnectTimer = null;
let socketConnected = false;
let loggedOut = false;
let shuttingDown = false;

// ---- pairing-code login ----
// With PAIRING_NUMBER set, the bot links with an 8-character code typed into
// WhatsApp (Linked devices > Link a device > "Link with phone number
// instead") rather than a QR code that has to be scanned off a console.
// Every new code = a new "link a device" push notification on that phone, so
// give up after a few unused ones instead of asking forever.
const MAX_PAIRING_ATTEMPTS = 5;
let pairingAttempts = 0;

async function requestPairing(sock) {
  pairingAttempts += 1;
  try {
    await sleep(1500); // WhatsApp needs a moment after the handshake before it accepts this
    const raw = await sock.requestPairingCode(PAIRING_NUMBER);
    const code = (raw.match(/.{1,4}/g) || [raw]).join('-');
    console.log(
      `\n============ WHATSAPP PAIRING CODE ============\n` +
        `            ${code}\n` +
        `===============================================\n` +
        `On the phone with number ${PAIRING_NUMBER}:\n` +
        `WhatsApp > Settings > Linked devices > Link a device >\n` +
        `"Link with phone number instead" > type the code above.\n` +
        `(code ${pairingAttempts}/${MAX_PAIRING_ATTEMPTS} - it expires after a few minutes; a new one is made automatically if it does)\n`
    );
    return true;
  } catch (err) {
    logger.error(`Could not request a pairing code: ${err.message}`);
    return false;
  }
}

/**
 * After WhatsApp ends the login (401), the saved session is worthless. Move
 * it aside (not delete - kept until the next one replaces it) so the next
 * start begins a clean pairing instead of retrying dead credentials.
 */
function archiveDeadSession() {
  const dir = path.resolve(SESSION_PATH);
  try {
    if (!fs.existsSync(dir)) return;
    const parent = path.dirname(dir);
    const base = path.basename(dir);
    for (const name of fs.readdirSync(parent)) {
      if (name.startsWith(`${base}_dead_`)) fs.rmSync(path.join(parent, name), { recursive: true, force: true });
    }
    fs.renameSync(dir, path.join(parent, `${base}_dead_${Date.now()}`));
    logger.info('Dead WhatsApp session moved aside; a fresh pairing will start.');
  } catch (err) {
    logger.error(`Could not move the dead session aside: ${err.message}`);
  }
}

// Current live socket, reassigned on every reconnect. The 6 schedulers
// below are setInterval-based and must only ever be started ONCE for the
// life of the process - starting them inside start() used to mean every
// reconnect left one more permanently-running interval leaked, forever
// bound to that connection's now-dead socket (visible as duplicate
// "Auto-greeting failed ... Connection Closed" pairs in the logs after a
// couple of reconnects). sockProxy forwards every call to whatever socket
// is current, so schedulers can hold one stable reference across reconnects
// instead of capturing one that goes stale.
let currentSock = null;
const sockProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!currentSock) return undefined;
      const value = currentSock[prop];
      return typeof value === 'function' ? value.bind(currentSock) : value;
    },
  }
);
let backgroundStarted = false;

// ---- sent-message memory (Baileys' `getMessage`) ----
// When a group member's phone fails to decrypt one of the bot's messages it
// asks the bot to send it again. Baileys can only do that if it can look the
// original message up - without this, those members just see "Waiting for
// this message..." forever, which looks exactly like "the bot ignored me".
const SENT_STORE_MAX = 1000;
const sentStore = new Map(); // message id -> message content
function rememberSent(sent) {
  const id = sent && sent.key && sent.key.id;
  if (!id || !sent.message) return;
  sentStore.set(id, sent.message);
  if (sentStore.size > SENT_STORE_MAX) sentStore.delete(sentStore.keys().next().value);
}

// ---- outgoing pacing ----
// Spaces the START of consecutive sends by SEND_GAP_MS. When many groups run
// commands in the same second this turns a machine-gun burst of sends into a
// steady stream. Deletes (moderation) are never delayed.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextSendAt = 0;
async function paceSend() {
  const now = Date.now();
  const startAt = Math.max(now, nextSendAt);
  // Randomised (0.6x - 1.4x) so the spacing doesn't look like a fixed-rate script.
  nextSendAt = startAt + SEND_GAP_MS * (0.6 + Math.random() * 0.8);
  if (startAt > now) await sleep(startAt - now);
}

function installSendWrapper(sock) {
  const rawSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    if (SEND_GAP_MS > 0 && !(content && content.delete)) await paceSend();
    const sent = await rawSend(jid, content, options);
    rememberSent(sent);
    return sent;
  };

  const rawRelay = sock.relayMessage.bind(sock);
  sock.relayMessage = async (jid, message, options = {}) => {
    const isGroupStatus = (options.additionalNodes || []).some(
      (node) => node.tag === 'meta' && node.attrs?.is_group_status === 'true'
    );
    if (SEND_GAP_MS > 0 && isGroupStatus) await paceSend();
    const sentId = await rawRelay(jid, message, options);
    if (isGroupStatus && sentId) rememberSent({ key: { id: sentId }, message });
    return sentId;
  };
}

function scheduleReconnect(delayMs) {
  if (shuttingDown || reconnectTimer) return; // never stack two reconnects on top of each other
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await start();
    } catch (err) {
      // Previously a failure here ended the retry chain for good: the process
      // stayed alive but the bot was dead until someone restarted it.
      consecutiveFailures += 1;
      const retryMs = Math.min(5_000 * 2 ** (consecutiveFailures - 1), 60_000);
      logger.error(`Reconnect attempt failed: ${err.stack || err.message} - retrying in ${Math.round(retryMs / 1000)}s`);
      scheduleReconnect(retryMs);
    }
  }, delayMs);
}

/** Compact, safe-to-log version of whatever extra data WhatsApp attached to a disconnect. */
function describeDisconnectData(data) {
  if (!data) return 'no extra data';
  try {
    const text = JSON.stringify(data, (key, value) => {
      if (value && value.type === 'Buffer') return '[binary]';
      if (value instanceof Uint8Array) return '[binary]';
      return value;
    });
    return text.length > 600 ? `${text.slice(0, 600)}...` : text;
  } catch (err) {
    return 'unreadable extra data';
  }
}

function reasonName(statusCode) {
  const entry = Object.entries(DisconnectReason).find(([, value]) => value === statusCode);
  return entry ? entry[0] : 'unknown';
}

async function start() {
  // Reconnects used to call connectDB() unconditionally; only (re)connect
  // when Mongo isn't actually up so the backfill/listeners don't rerun.
  if (mongoose.connection.readyState !== 1) await connectDB();

  const commands = loadCommands();

  const authDir = path.resolve(SESSION_PATH);
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  if (PAIRING_NUMBER && !state.creds.registered && pairingAttempts >= MAX_PAIRING_ATTEMPTS) {
    logger.warn(`${MAX_PAIRING_ATTEMPTS} pairing codes were shown and none was used - falling back to QR login instead of spamming the phone with more link requests.`);
  }

  // fetchLatestBaileysVersion() pulls the current WA protocol version from
  // GitHub at runtime. If that request fails (network/proxy/AV hiccup), it
  // silently falls back to the version baked into the installed package,
  // which goes stale fast and gets hard-rejected by WhatsApp with a
  // "connection closed (code 405)" loop. FALLBACK_WA_VERSION below is a
  // known-good version as of 2026-07-28 - bump it (or check
  // https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json)
  // if 405s come back after the fetch keeps failing.
  const FALLBACK_WA_VERSION = [2, 3000, 1035194821];
  const fetchedVersion = await fetchLatestBaileysVersion();
  if (!fetchedVersion.isLatest) {
    logger.warn(`Could not fetch latest WA version, using fallback ${FALLBACK_WA_VERSION.join('.')}: ${fetchedVersion.error?.message || 'unknown error'}`);
  }
  const version = fetchedVersion.isLatest ? fetchedVersion.version : FALLBACK_WA_VERSION;

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // Baileys is very chatty on 'info' - our own logger.js handles output
    printQRInTerminal: false, // we render the QR ourselves below for a consistent look with the old bot
    generateHighQualityLinkPreview: true,
    // A generic/stale browser signature makes WhatsApp more likely to flag
    // and reject the handshake (seen as part of the 405 "Connection Failure" issue).
    browser: [BOT_NAME, 'Chrome', '121.0.0'],
    // Reconnects can otherwise loop rapidly and look like bot-ish behavior to WhatsApp - keep this modest.
    connectTimeoutMs: 60_000,
    // 30s is Baileys' default and closer to what real WhatsApp Web does; 15s
    // was pinging twice as often as a normal client.
    keepAliveIntervalMs: 30_000,
    // By default Baileys announces "online" the moment it connects and stays
    // that way, which no real linked device does 24/7 and which also stops
    // the phone from showing its own notifications. Off = behaves like a
    // normal companion device.
    markOnlineOnConnect: false,
    // Serve group member lists from our cache instead of Baileys asking
    // WhatsApp for them before every single group send (see waCompat.js).
    cachedGroupMetadata: peekGroupMetadata,
    // Lets Baileys re-send a message when a member's phone asks for it again.
    getMessage: async (key) => sentStore.get(key.id),
  });

  installSendWrapper(sock);
  currentSock = sock;

  sock.ev.on('creds.update', () => {
    saveCreds().catch((err) => logger.error('Failed to save WhatsApp credentials:', err.message));
  });

  // Keep the group cache honest: WhatsApp tells us when a group's members,
  // admins or settings change, so drop that group's cached copy.
  sock.ev.on('group-participants.update', (update) => {
    if (update && update.id) invalidateGroupMetadata(update.id);
    invalidateGroupCaches();
  });
  sock.ev.on('groups.update', (updates) => {
    for (const update of updates || []) {
      if (update && update.id) invalidateGroupMetadata(update.id);
    }
  });
  // "Delete for everyone" arrives as a 'messages.update' (REVOKE) in Baileys -
  // this is the event the deleted-message logs actually depend on.
  sock.ev.on('messages.update', (updates) => {
    try {
      handleMessageUpdates(updates);
    } catch (err) {
      logger.warn('deleted-log: failed to process message update:', err.message);
    }
  });
  // Delete-for-me / cleared chats (rare, mostly the bot account's own actions).
  sock.ev.on('messages.delete', (payload) => {
    handleDeleteEvent(payload);
  });

  let qrShown = false;
  let isConnected = false;
  let closeHandled = false; // a socket can report 'close' more than once - only react to the first
  let pairingRequested = false;

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const shouldUsePairing = !!PAIRING_NUMBER && !state.creds.registered && pairingAttempts < MAX_PAIRING_ATTEMPTS;

      if (shouldUsePairing) {
        // The 'qr' event just means "WhatsApp is ready to link a device" - ask
        // for a pairing code once per socket instead of drawing the QR.
        if (!pairingRequested) {
          pairingRequested = true;
          qrShown = true;
          requestPairing(sock).catch((err) => logger.error('Pairing fallback failed:', err.message));
        }
      } else {
        qrShown = true;
        console.log(`\nScan this QR code with the ${BOT_NAME} WhatsApp number (a new one prints automatically if it expires):\n`);
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'open' && !isConnected) {
      isConnected = true;
      socketConnected = true;
      loggedOut = false;
      pairingAttempts = 0;
      consecutiveFailures = 0;
      logger.info(`${BOT_NAME} is online as ${sock.user?.id?.split(':')[0]}`);
    }

    if (connection === 'close') {
      if (closeHandled) return;
      closeHandled = true;
      socketConnected = false;

      // Read the status code straight off the error - the old `instanceof Boom`
      // check silently returns null if two copies of @hapi/boom end up
      // installed, which would make every close look like an unknown one.
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
      const reason = reasonName(statusCode);
      const detail = lastDisconnect?.error?.message || 'no error message';

      if (statusCode === DisconnectReason.loggedOut) {
        loggedOut = true;
        // Nothing in the bot's own code logs itself out, so this came from
        // WhatsApp's side: either the linked device was removed (from the
        // phone's Linked Devices screen, or by WhatsApp itself) or the
        // number was flagged/restricted. The text + data below are what
        // WhatsApp actually sent and are the best clue to which one.
        logger.warn(`Client logged out by WhatsApp (401: ${detail}). WhatsApp said: ${describeDisconnectData(lastDisconnect?.error?.data)}`);
        if (PAIRING_NUMBER && AUTO_RELINK && pairingAttempts < MAX_PAIRING_ATTEMPTS) {
          logger.warn('The saved session is now invalid. A fresh pairing code will be shown in about 15 seconds - remove any leftover "Bluehunter" entry in Linked devices on the phone first, then enter the new code.');
          archiveDeadSession();
          scheduleReconnect(15_000);
        } else {
          logger.warn('The bot will stay idle (no reconnect - the saved session is now invalid). Check Linked Devices on the phone, then delete the session folder and link again ONCE. Restarting without linking again changes nothing.');
        }
        return; // never retry the DEAD credentials - that only loops
      }

      let delayMs;
      if (statusCode === DisconnectReason.restartRequired) {
        // Normal right after scanning the QR - WhatsApp wants a fresh socket. Not a failure.
        delayMs = 1_000;
      } else if (statusCode === DisconnectReason.connectionReplaced) {
        // Some OTHER process/device is logged in with this same session (a
        // second copy of the bot, your PC, an old container that hasn't
        // stopped). Reconnecting every few seconds just makes the two copies
        // kick each other off in a loop and corrupt the shared session
        // files - the source of endless "Bad MAC" errors.
        consecutiveFailures += 1;
        delayMs = 60_000;
        logger.warn('Connection REPLACED (440): another instance or device is using this same WhatsApp session. Make sure only ONE copy of the bot is running (check your PC and any old server/container). Waiting 60s before retrying.');
      } else if (statusCode === 405) {
        // 405 during registration (no QR ever shown) means WhatsApp is actively
        // rejecting the pairing attempt server-side - almost always because
        // this account/IP tripped their abuse detection from too many rapid
        // registration attempts. Retrying immediately only extends the block,
        // so back off hard and grow the delay on repeated failures instead of
        // hammering it every few seconds.
        consecutiveFailures += 1;
        delayMs = Math.min(30_000 * 2 ** (consecutiveFailures - 1), 15 * 60_000); // 30s, 1m, 2m, 4m... capped at 15m
        if (consecutiveFailures >= 3) {
          logger.warn('Repeated 405s during registration usually means WhatsApp is temporarily blocking new device pairing for this number/IP. Consider stopping the bot for 30-60+ minutes before trying again.');
        }
      } else {
        consecutiveFailures += 1;
        delayMs = Math.min(5_000 * 2 ** (consecutiveFailures - 1), 60_000); // 5s, 10s, 20s, 40s, 60s...
        if (statusCode === DisconnectReason.badSession && consecutiveFailures >= 3) {
          logger.warn('Repeated "bad session" closes - the saved session files are likely corrupted. Stop the bot, delete the session folder and re-scan.');
        }
      }

      logger.warn(`Connection closed (code ${statusCode} ${reason}: ${detail}), reconnecting in ${Math.round(delayMs / 1000)}s...`);
      scheduleReconnect(delayMs);
    }
  });

  // Same "loud failure" pattern as the old bot.js: if nothing happens within
  // 30s, something is wrong with the connection, not with your WhatsApp account.
  setTimeout(() => {
    if (!qrShown && !isConnected && !loggedOut) {
      logger.warn('Not connected after 30s. Check your network connection and that the session folder is writable.');
    }
  }, 30_000).unref();

  registerReadyEvent(sock);
  registerMessageEvent(sock, commands);
  registerGroupParticipantsEvent(sock);

  if (!backgroundStarted) {
    backgroundStarted = true;
    startReminderScheduler(sockProxy);
    startGroupActivityScheduler(sockProxy);
    startAutoGreetingScheduler(sockProxy);
    startAutoLockScheduler(sockProxy);
    startTimedLockScheduler(sockProxy);
    startBibleScheduler(sockProxy);
    startJokeScheduler(sockProxy);
    startAutoKickScheduler(sockProxy);
    startReminderPostScheduler(sockProxy);
    startYoutubeAlertScheduler(sockProxy);
    startXAlertScheduler(sockProxy);
    startWebServer({
      sock: sockProxy,
      getStatus: () => ({
        connected: socketConnected,
        loggedOut,
        queue: registerMessageEvent.getQueueStats(),
        groupsCached: groupMetadataCacheSize(),
        commands: new Set(commands.values()).size,
      }),
    });
    startMemorySweeper();
    startDeletedLogPruner();
    startHealthMonitor({
      getExtra: () => ({
        queue: registerMessageEvent.getQueueStats(),
        connected: socketConnected,
        loggedOut,
        groupsCached: groupMetadataCacheSize(),
      }),
    });
  }

  return sock;
}

// ---- process-level safety nets ----
// These keep one bad promise/exception from taking the whole bot down, and
// leave a trail in bluehunter.log. If the bot ever stops with NO "exiting" or
// "Received SIGTERM" line right before it - i.e. the log just ends - the
// process was killed from outside (almost always the host running out of
// memory); the [HEALTH] lines before that show how close it was.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', (reason && (reason.stack || reason.message)) || reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', (err && (err.stack || err.message)) || err);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn(`Received ${signal} - shutting down (panel stop/restart).`);
  setTimeout(() => process.exit(0), 1000); // brief grace period so the session files finish writing
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('exit', (code) => {
  logger.warn(`Process exiting (code ${code}).`);
});

start().catch((err) => {
  // Used to process.exit(1) here, which turns any startup hiccup into a dead
  // server that needs a manual restart. Retry with backoff instead.
  consecutiveFailures += 1;
  const retryMs = Math.min(5_000 * 2 ** (consecutiveFailures - 1), 60_000);
  logger.error(`Startup failed: ${err.stack || err.message} - retrying in ${Math.round(retryMs / 1000)}s`);
  scheduleReconnect(retryMs);
});
