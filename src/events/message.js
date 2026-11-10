const GroupSettings = require('../models/GroupSettings');
const { findMute, removeMute } = require('../utils/muteStore');
const Activity = require('../models/Activity');
const GroupDailyActivity = require('../models/GroupDailyActivity');
const audit = require('../utils/auditLog');
const BotConfig = require('../models/BotConfig');
const { isOwner, isGroupAdmin, isBotAdmin } = require('../utils/permissions');
const { buildChatCompat, buildMsgCompat } = require('../utils/waCompat');
const floodTracker = require('../utils/floodTracker');
const cooldown = require('../utils/cooldown');
const { getAutoReply } = require('../utils/autoreply');
const { applyModerationAction } = require('../utils/moderationAction');
const { containsBadWords } = require('../utils/badwords');
const { containsBlockedLink } = require('../utils/antilink');
const { isForwardedMessage } = require('../utils/antiforward');
const { isLikelyBotMessage } = require('../utils/antibot');
const { maybeHandleAiChat } = require('../utils/aiChat');
const { maybeHandleBibleReference } = require('../utils/bibleVerseDetector');
const { moderateMessage, handleViolation, detectUnderageViolation } = require('../utils/aiModeration');
const { maybeRevealViewOnce } = require('../utils/viewOnce');
const { checkAndEnforceGroupSafety } = require('../utils/groupSafety');
const { maybeHandleGameRound } = require('../utils/gameRounds');
const { maybeHandleLobbyJoin } = require('../utils/gameLobby');
const { trackIncomingMessage } = require('../utils/deletedLogs');
const { isGroupStatusMention, unwrapMessage } = require('../utils/mediaContent');
const crowdModeration = require('../utils/crowdModeration');
const { maybeHandleNaturalCommand } = require('../utils/nlCommands');
const raidTracker = require('../utils/raidTracker');
const { maybeRagebait } = require('../utils/ragebait');
const { handleAfk } = require('../utils/afk');
const { createLimiter } = require('../utils/limiter');
const { MAX_CONCURRENT_MESSAGES, MESSAGE_TASK_TIMEOUT_MS, READ_BEFORE_REPLY, DOWNLOAD_CONCURRENCY, DOWNLOAD_MAX_QUEUE } = require('../config');
const logger = require('../utils/logger');


// ---- load control ----
// Every incoming message used to start its full pipeline the instant it
// arrived. With many groups active at once that meant dozens of simultaneous
// Mongo queries, OpenAI calls and media downloads. Now at most
// MAX_CONCURRENT_MESSAGES run at a time and the rest queue in order; a task
// that hangs past MESSAGE_TASK_TIMEOUT_MS stops blocking the queue.
const limiter = createLimiter({
  concurrency: MAX_CONCURRENT_MESSAGES,
  taskTimeoutMs: MESSAGE_TASK_TIMEOUT_MS,
  onError: (err) => logger.error('message handler error:', describeError(err)),
  onTimeout: () => logger.warn(`A message took longer than ${Math.round(MESSAGE_TASK_TIMEOUT_MS / 1000)}s - freeing its queue slot.`),
});

// Downloader commands buffer whole files (up to ~90MB) in memory. Ten of
// them at once is enough to get the process killed for running out of RAM, so
// they go through their own small queue. taskTimeoutMs is generous because a
// slow download plus upload can legitimately take a few minutes.
const downloadLimiter = createLimiter({ concurrency: DOWNLOAD_CONCURRENCY, taskTimeoutMs: 5 * 60_000 });

function describeError(err) {
  const frame = ((err && err.stack) || '').split('\n')[1];
  return `${(err && err.message) || err}${frame ? ` ${frame.trim()}` : ''}`;
}

// The global bot config (mode / approved groups / support group) is read on
// EVERY group message but only changes when the owner runs a system command,
// so a few seconds of caching saves one Mongo round-trip per message.
const BOT_CONFIG_TTL_MS = 5_000;
let botConfigCache = { doc: null, fetchedAt: 0 };
async function getBotConfigCached() {
  const now = Date.now();
  if (botConfigCache.doc && now - botConfigCache.fetchedAt < BOT_CONFIG_TTL_MS) return botConfigCache.doc;
  const doc = await BotConfig.getOrCreate();
  botConfigCache = { doc, fetchedAt: Date.now() };
  return doc;
}

// lastActivityAt only needs day-level accuracy (inactive-group cleanup runs
// on a days-long cutoff), but it used to be a Mongo WRITE on every message.
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;
const lastActivityWriteAt = new Map(); // groupId -> timestamp of last write
function touchGroupActivity(groupId) {
  const now = Date.now();
  if (now - (lastActivityWriteAt.get(groupId) || 0) < ACTIVITY_WRITE_INTERVAL_MS) return;
  lastActivityWriteAt.set(groupId, now);
  GroupSettings.findOneAndUpdate({ groupId }, { lastActivityAt: new Date() }).catch(() => {});
}

module.exports = function registerMessageEvent(sock, commands) {
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Track every message handed to us, regardless of upsert type - a message
    // delivered as a history-sync/catch-up batch (type 'append', e.g. right
    // after a brief reconnect) is still a real, recent message someone could
    // delete moments later. Gating this on 'notify' too meant those got
    // silently missed: the delete event would arrive fine, but the bot would
    // have no record of the original message to log - exactly the "message
    // was deleted but the bot never saw it" cases that weren't actually old
    // messages from a previous session.
    for (const waMessage of messages) {
      if (waMessage.key?.fromMe || !waMessage.message || waMessage.key?.remoteJid === 'status@broadcast') continue;
      trackIncomingMessage(waMessage).catch((err) => logger.warn('Failed to track incoming message for deleted-log:', err.message));
    }

    // 'notify' = new incoming messages. 'append'/other types are history sync
    // etc - the bot should not actively reply to, moderate, or otherwise react
    // to those, only track them (above) in case they get deleted shortly after.
    if (type !== 'notify') return;

    for (const waMessage of messages) {
      limiter.run(() => processMessage(sock, commands, waMessage));
    }
  });
};

module.exports.getQueueStats = () => limiter.stats();

async function processMessage(sock, commands, waMessage) {
  try {
    if (waMessage.key.fromMe) return; // don't process the bot's own messages
    if (!waMessage.message) return; // e.g. protocol/reaction messages with no content

    const chatJid = waMessage.key.remoteJid;
    if (chatJid === 'status@broadcast') return;

    const chat = await buildChatCompat(sock, chatJid);
    const msg = buildMsgCompat(sock, waMessage, chatJid);
    const senderId = msg.author || msg.from;
    // (tracked for deleted-log purposes up in the messages.upsert handler,
    // for every upsert type - not just here, which only runs for 'notify')

    // ---- DMs: only the owner gets normal bot behavior. Everyone else is
    // silently ignored - no auto-reply, no auto-block. A prior version
    // auto-messaged every non-owner DM sender, which is exactly the kind
    // of automated-outbound-to-many-different-numbers pattern WhatsApp's
    // spam detection flags, and is suspected to have caused a ban.
    // Exception: /verify (and aliases) must work in DMs so admins can get
    // a login code when group→DM delivery fails (common with @lid JIDs). ----
    if (!chat.isGroup) {
      if (!(await isOwner(sock, senderId))) {
        const body = (msg.body || '').trim().toLowerCase();
        const isVerifyDm =
          body === '/verify' ||
          body === '/dashboard' ||
          body === '/panel' ||
          body.startsWith('/verify ') ||
          body.startsWith('/dashboard ') ||
          body.startsWith('/panel ');
        if (!isVerifyDm) return;
        await handleCommand(sock, msg, chat, senderId, commands, null);
        return;
      }
      await handleAfk({ chat, msg, senderId });
      await handleCommand(sock, msg, chat, senderId, commands, null);
      return;
    }

    // ---- mandatory baseline safety net: runs before ANY other gating
    // logic (including private mode) - this is a hard floor, not a
    // per-group setting. Uses OpenAI's free moderation endpoint.
    // Run alongside the BotConfig fetch below rather than before it -
    // the two are independent (BotConfig doesn't need the safety verdict
    // to know its own mode), and the OpenAI call is by far the slower of
    // the two, so the Mongo round-trip is effectively free once
    // overlapped with it instead of stacked in sequence after it. ----
    const [leftForSafety, botConfig] = await Promise.all([
      checkAndEnforceGroupSafety({ sock, waMessage, chat, senderId }),
      getBotConfigCached(),
    ]);
    if (leftForSafety) return;

    // ---- global bot mode: private mode only responds in approved groups ----
    if (
      botConfig.mode === 'private' &&
      !botConfig.approvedGroups.includes(chat.id._serialized) &&
      !(await isOwner(sock, senderId))
    ) {
      return;
    }

    // ---- AFK / settings / mute lookup: three independent operations
    // (none needs another's result) run concurrently instead of stacked
    // as three sequential Mongo round-trips. ----
    // findMute matches by normalized id, not a raw jid string - WhatsApp
    // can report the same sender under a different jid form (phone jid vs
    // @lid) than however they were originally muted, and a raw match
    // silently let muted people keep talking as if nothing had happened.
    const [, settings, mute] = await Promise.all([
      handleAfk({ chat, msg, senderId }),
      GroupSettings.getOrCreate(chat.id._serialized),
      findMute(chat.id._serialized, senderId),
    ]);

    // waMessage.pushName is the sender's WhatsApp display name at the time
    // they sent this message - best-effort (not always present), but far
    // better than showing raw numbers/lids in /activity and /topchatters.
    Activity.track(chat.id._serialized, senderId, waMessage.pushName).catch(() => {});
    GroupDailyActivity.bump(chat.id._serialized).catch(() => {});
    touchGroupActivity(chat.id._serialized);

    // ---- enforce active mute ----
    if (mute) {
      const expired = mute.mutedUntil && mute.mutedUntil.getTime() <= Date.now();
      if (expired) {
        await removeMute(mute);
      } else {
        await msg.delete(true);
        return;
      }
    }

    const senderIsAdmin = await isGroupAdmin(sock, chat, senderId);
    const senderIsOwner = await isOwner(sock, senderId);
    const senderIsPrivileged = senderIsAdmin || senderIsOwner;

    // Handle WhatsApp group-status shares before the regular message filters,
    // so the share is removed and the member is warned without delay.
    if (settings.antigroupstatus && isGroupStatusMention(waMessage) && !senderIsPrivileged) {
      await applyModerationAction({
        action: 'strike',
        chat,
        msg,
        senderId,
        reason: 'WhatsApp group statuses are not allowed here.',
        requireDelete: true,
      });
      return;
    }

    // ---- antiraid: catches coordinated spam from many different accounts,
    // which per-user antiflood/antispam can't (each sender only posts once) ----
    if (settings.antiraid && !senderIsPrivileged) {
      raidTracker.record(chat.id._serialized, senderId);
      if (raidTracker.checkAndConsumeRaid(chat.id._serialized)) {
        await GroupSettings.findOneAndUpdate({ groupId: chat.id._serialized }, { isOpen: false }, { upsert: true });
        try {
          await chat.setMessagesAdminsOnly(true);
        } catch (err) {
          // bot may not be admin
        }
        await chat.sendMessage(
          '🚨 Raid detected - multiple accounts posting at once. Group locked to admins only.\nRun /open once things settle down.'
        );
      }
    }

    // ---- closed group: only admins may talk (bot-side enforcement backup) ----
    if (!settings.isOpen && !senderIsPrivileged) {
      await msg.delete(true);
      return;
    }

    // ---- antibot: other people's bots in the group. Admins/owner are exempt
    // (senderIsPrivileged), so a bot that is a group admin is left alone.
    // The action reuses the group's antilinkAction setting. ----
    if (settings.antibot && !senderIsPrivileged && isLikelyBotMessage(waMessage)) {
      await applyModerationAction({
        action: settings.antilinkAction || 'warn',
        chat,
        msg,
        senderId,
        reason: 'other bots are not allowed in this group.',
      });
      return;
    }

    // ---- antispam / antiflood ----
    if ((settings.antispam || settings.antiflood) && !senderIsPrivileged) {
      floodTracker.record(chat.id._serialized, senderId);
      if (settings.antiflood && floodTracker.isFlooding(chat.id._serialized, senderId)) {
        // isFlooding stays true for every message in the burst, so only
        // actually notify/strike once per NOTIFY_COOLDOWN_MS - otherwise
        // the bot ends up replying to every flooded message, which is
        // just the bot flooding back. Still delete every single one.
        if (floodTracker.shouldNotify(chat.id._serialized, senderId)) {
          await applyModerationAction({
            action: settings.antifloodAction || 'warn',
            chat,
            msg,
            senderId,
            reason: "please slow down, you're flooding the chat.",
          });
        } else {
          await msg.delete(true).catch(() => {});
        }
        return;
      }
      if (settings.antispam && floodTracker.isSpamming(chat.id._serialized, senderId)) {
        if (floodTracker.shouldNotify(chat.id._serialized, senderId)) {
          await applyModerationAction({
            action: settings.antispamAction || 'warn',
            chat,
            msg,
            senderId,
            reason: 'that looks like spam, please stop.',
          });
        } else {
          await msg.delete(true).catch(() => {});
        }
        return;
      }
    }

    // ---- antilink: now catches any link (not just WhatsApp group invites),
    // see utils/antilink.js. Command messages are exempt so admin-run
    // downloader commands (/ytmp4, /ig, /x, /spotify) with a URL argument
    // don't get deleted before they even execute. ----
    if (
      settings.antilink &&
      !senderIsPrivileged &&
      !(msg.body || '').startsWith(settings.prefix) &&
      containsBlockedLink(msg.body, settings.antilinkWhitelist)
    ) {
      await applyModerationAction({
        action: settings.antilinkAction || 'warn',
        chat,
        msg,
        senderId,
        reason: 'links are not allowed here.',
      });
      return;
    }

    // ---- antiforward: blocks forwarded messages/media ----
    if (settings.antiforward && !senderIsPrivileged && isForwardedMessage(waMessage)) {
      await applyModerationAction({
        action: settings.antiforwardAction || 'warn',
        chat,
        msg,
        senderId,
        reason: 'forwarded messages are not allowed here.',
      });
      return;
    }

    // Under-13 age disclosures are an immediate, zero-tolerance removal even
    // when AI moderation is off or the user is only chatting in plain text.
    if (!senderIsPrivileged && detectUnderageViolation(msg.body || '')) {
      await applyModerationAction({
        action: 'kick',
        chat,
        msg,
        senderId,
        reason: 'under-13 age disclosure is not allowed in this group.',
      });
      return;
    }

    // ---- AI moderation: reads every text/image/video/sticker/voice/document
    // against the group description (the group's own rules), plus baseline
    // inappropriate-content judgment. Interpersonal conflicts get a
    // de-escalation attempt before any strike - see aiModeration.js.
    // Runs after the narrower/cheaper filters above so anything they
    // already caught (and continue'd on) never costs an API call. ----
    if (settings.aiModerationEnabled) {
      // Dark jokes / offensive content: wait for the group's reaction. A
      // complaint ("wtf", "not funny", a disgusted emoji) about a recent message
      // gets that message checked once and quietly removed if it really is
      // offensive - see crowdModeration.js. Runs in the background so it never
      // delays the rest of the pipeline.
      if (unwrapMessage(waMessage.message)?.inner?.reactionMessage) {
        crowdModeration.handleReaction({ chat, waMessage, senderId }).catch((err) => logger.warn('crowd moderation (reaction):', err.message));
        return; // a reaction is not a message - nothing else to run on it
      }
      crowdModeration.handleComplaint({ chat, waMessage, msg, senderId }).catch((err) => logger.warn('crowd moderation (complaint):', err.message));

      if (!senderIsPrivileged) {
        const verdict = await moderateMessage({ sock, waMessage, chat });
        if (verdict) {
          await handleViolation({ chat, msg, senderId, verdict });
          return;
        }
      }
      crowdModeration.remember({ groupId: chat.id._serialized, waMessage, msg, senderId, privileged: senderIsPrivileged });
    }

    // ---- antiviewonce: reveal view-once photos/videos back into the chat.
    // Deliberately NOT gated by senderIsPrivileged - this is a transparency
    // feature, not a punishment, so it applies to admins too. ----
    if (settings.antiviewonce) {
      const revealed = await maybeRevealViewOnce({ sock, waMessage, chat, senderId });
      if (revealed) return;
    }

    // ---- bad word filter (built-in profanity list + this group's own
    // custom words from /badword add) ----
    if (settings.filterBadwords && !senderIsPrivileged) {
      if (containsBadWords(msg.body, settings.customBadwords)) {
        await applyModerationAction({
          action: settings.badwordsAction || 'delete',
          chat,
          msg,
          senderId,
          reason: 'watch your language, that word is not allowed here.',
        });
        return;
      }
    }

    // ---- Bible reference auto-lookup (chapter references return verse 1) -
    // enabled by default, with an on/off toggle. Separate from the daily
    // scheduled verse. Real Bible text only, no AI involved. ----
    if (settings.bibleVerseDetectEnabled !== false && !(msg.body || '').startsWith(settings.prefix)) {
      const verseHandled = await maybeHandleBibleReference({ msg, translationCode: settings.bibleVersion });
      if (verseHandled) return;
    }

    // ---- plain-word lobby join: non-command 'join' should join the active game lobby,
    // while the owner-only slash command /join keeps its separate group-accept flow. ----
    if (!(msg.body || '').startsWith(settings.prefix)) {
      const text = (msg.body || '').trim();
      const plainJoin = /^join$/i.test(text);
      if (plainJoin) {
        const result = maybeHandleLobbyJoin({ groupId: chat.id._serialized, userId: senderId });
        if (result && result.handled) {
          await msg.reply(result.reason);
          return;
        }
      }
    }

    // ---- group mini-games: if an active game round is running, only the next
    // valid game answer should be handled here, not the AI chat or other ambient logic. ----
    if (!(msg.body || '').startsWith(settings.prefix)) {
      const roundHandled = await maybeHandleGameRound({ chat, msg, senderId });
      if (roundHandled) return;
    }

    // ---- "BlueHunter, <do something>": plain-language admin requests. The AI
    // only picks which existing command to run; it then goes through the normal
    // command pipeline (same permissions/cooldowns). Admins/owner only - anyone
    // else, and anything that isn't an action, falls through to normal chat. ----
    if (!(msg.body || '').startsWith(settings.prefix) && !(settings.silent && !senderIsOwner)) {
      const handledNl = await maybeHandleNaturalCommand({
        sock,
        waMessage,
        chat,
        msg,
        senderId,
        settings,
        senderIsAdmin,
        senderIsOwner,
        commands,
        runCommand: (synthMsg) => handleCommand(sock, synthMsg, chat, senderId, commands, settings, { senderIsAdmin, senderIsOwner }),
      });
      if (handledNl) return;
    }

    // ---- passive ragebait: no command needed, per-group toggle ----
    if (
      typeof maybeRagebait === 'function' &&
      settings.ragebaitEnabled !== false &&
      !(msg.body || '').startsWith(settings.prefix) &&
      !(settings.silent && !senderIsOwner)
    ) {
      const baited = await maybeRagebait({ sock, waMessage, chat, msg, senderId });
      if (baited) return;
    }

    // ---- AI chatbot (only when mentioned/replied to, rate-limited) ----
    if (!(msg.body || '').startsWith(settings.prefix)) {
      const aiHandled = await maybeHandleAiChat({ sock, waMessage, chat, msg, senderId, settings, senderIsOwner, senderIsAdmin, commands });
      if (aiHandled) return;
    }

    // ---- autoreply for plain chat (not commands) ----
    if (settings.autoreply && !(msg.body || '').startsWith(settings.prefix) && !(settings.silent && !senderIsOwner)) {
      const reply = getAutoReply(msg.body);
      if (reply) {
        await chat.sendMessage(reply);
        return;
      }
    }

    // ---- silent mode ----
    if (settings.silent && !senderIsOwner && !(msg.body || '').startsWith(settings.prefix)) return;

    // ---- support group: only the owner may run commands here (moderation
    // above still applies to everyone - see setsupportgroup.js) ----
    if (botConfig.supportGroupId && chat.id._serialized === botConfig.supportGroupId && !senderIsOwner) {
      return;
    }

    await handleCommand(sock, msg, chat, senderId, commands, settings, { senderIsAdmin, senderIsOwner });
  } catch (err) {
    logger.error('message handler error:', describeError(err));
  }
}

async function handleCommand(sock, msg, chat, senderId, commands, settings, precomputed) {
  const prefix = settings ? settings.prefix : '/';
  const body = msg.body || '';
  if (!body.startsWith(prefix)) return;

  const args = body.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const command = commands.get(commandName);
  if (!command) return;

  const senderIsOwner = precomputed ? precomputed.senderIsOwner : await isOwner(sock, senderId);

  if (!senderIsOwner) {
    const remaining = cooldown.getRemaining(senderId, chat.id._serialized);
    if (remaining > 0) {
      return msg.reply(`⏳ Slow down! Wait ${Math.ceil(remaining / 1000)}s before using another command.`);
    }
  }

  if (command.groupOnly && !chat.isGroup) {
    return msg.reply('This command only works inside a group.');
  }

  if (command.ownerOnly && !senderIsOwner) {
    return msg.reply('🚫 This command is restricted to the bot owner.');
  }

  if (command.adminOnly && chat.isGroup) {
    const senderIsAdmin = precomputed ? precomputed.senderIsAdmin : await isGroupAdmin(sock, chat, senderId);
    if (!senderIsAdmin && !senderIsOwner) {
      return msg.reply('🚫 Only group admins can use this command.');
    }
  }

  if (command.requiresBotAdmin && chat.isGroup && !isBotAdmin(chat, sock)) {
    return msg.reply('⚠️ I need to be an admin in this group to do that.');
  }

  cooldown.trigger(senderId, chat.id._serialized);

  // A person reads a message before replying to it. A bot that answers
  // hundreds of messages it never "read" is an easy pattern to spot.
  if (READ_BEFORE_REPLY && msg._raw && msg._raw.key && typeof sock.readMessages === 'function') {
    sock.readMessages([msg._raw.key]).catch(() => {});
  }

  try {
    // `client` is now the Baileys socket - command files that only use
    // client.info.wid._serialized (permissions.js does this internally now)
    // or pass client straight to isBotAdmin don't need changes.
    const ctx = { client: sock, msg, chat, args, senderId };
    // Admin commands in a group: remember the settings before, and compare
    // after, so the dashboard can show who changed what from the group.
    const gid = chat.id._serialized;
    const watch = chat.isGroup && command.adminOnly;
    const before = watch ? await audit.snapshotSettings(gid) : null;
    await audit.runAs({ actorId: senderId, source: 'command', command: command.name }, async () => {
      if (command.category === 'downloader') {
        if (downloadLimiter.stats().queued >= DOWNLOAD_MAX_QUEUE) {
          return msg.reply('⏳ The downloader is busy right now - try again in a minute.');
        }
        await downloadLimiter.exec(() => command.execute(ctx));
      } else {
        await command.execute(ctx);
      }
    });
    if (watch) {
      audit.logSettingsDiff({ groupId: gid, actorId: senderId, source: 'command', command: command.name, before }).catch(() => {});
      audit.logGroupCommand({ groupId: gid, actorId: senderId, command: command.name, args });
    }
  } catch (err) {
    if (/connection closed/i.test((err && err.message) || '')) {
      // WhatsApp dropped mid-command - a one-line note, not a stack trace,
      // and no point trying to send a reply over a dead connection.
      logger.warn(`Command "${command.name}" interrupted: the WhatsApp connection closed.`);
      return;
    }
    logger.error(`Error running command "${command.name}": ${describeError(err)}`);
    try {
      await msg.reply(`❌ Something went wrong running /${command.name}.`);
    } catch (replyErr) {
      // can't even reply (connection issue) - nothing more to do
    }
  }
}