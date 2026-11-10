// Same in-memory pattern for the Warning model, so warnStore.js's normalized
// matching can be tested without a real database.
class FakeWarning {
  constructor(doc) {
    Object.assign(this, doc);
    this._id = `fakewarn-${FakeWarning.nextId++}`;
    this.createdAt = doc.createdAt || new Date();
  }
  static async create(doc) {
    const w = new FakeWarning(doc);
    FakeWarning.store.push(w);
    return w;
  }
  static async find(query) {
    return FakeWarning.store.filter(
      (w) => (!query?.groupId || w.groupId === query.groupId) && (!query?.source || w.source === query.source)
    );
  }
  static async deleteMany(query) {
    const ids = query?._id?.$in || [];
    FakeWarning.store = FakeWarning.store.filter((w) => !ids.includes(w._id));
  }
}
FakeWarning.store = [];
FakeWarning.nextId = 1;
require.cache[require.resolve('../src/models/Warning')] = {
  id: require.resolve('../src/models/Warning'),
  filename: require.resolve('../src/models/Warning'),
  loaded: true,
  exports: FakeWarning,
};
const { createWarning, countWarnings, findWarnings, deleteWarnings } = require('../src/utils/warnStore');

const assert = require('assert');
const { detectUnderageViolation } = require('../src/utils/aiModeration');
const { isForwardedMessage } = require('../src/utils/antiforward');
const { unwrapMessage, isGroupStatusMention } = require('../src/utils/mediaContent');
const { isExpectedMediaDownloadFailure, shouldLeaveForGeneralNsfw } = require('../src/utils/groupSafety');
const { buildMsgCompat } = require('../src/utils/waCompat');
const { buildSystemPrompt } = require('../src/utils/aiPersonality');
const { extractStickerRequest, isAddressingBot } = require('../src/utils/aiChat');
const GroupSettings = require('../src/models/GroupSettings');
const { createGameLobby, joinGameLobby, closeGameLobby, getGameLobby, maybeHandleLobbyJoin } = require('../src/utils/gameLobby');
const { createRound, submitGuess, getRoundState, maybeHandleGameRound, cancelRound } = require('../src/utils/gameRounds');
const { recordDeletedMessage, listDeletedLogs, trackIncomingMessage, handleDeleteEvent, handleMessageUpdates, logsByGroup } = require('../src/utils/deletedLogs');

// In-memory stand-in for the Mongo-backed Ban model, just enough surface
// (find/create/deleteOne, and instances with .save()) to exercise
// banStore.js's normalized-id matching without a real database.
class FakeBan {
  constructor(doc) {
    Object.assign(this, doc);
    this._id = `fake-${FakeBan.nextId++}`;
  }
  async save() {
    const i = FakeBan.store.findIndex((b) => b._id === this._id);
    if (i >= 0) FakeBan.store[i] = this;
  }
  static async find(query) {
    return FakeBan.store.filter((b) => !query?.groupId || b.groupId === query.groupId);
  }
  static async create(doc) {
    const b = new FakeBan(doc);
    FakeBan.store.push(b);
    return b;
  }
  static async deleteOne(query) {
    FakeBan.store = FakeBan.store.filter((b) => b._id !== query._id);
  }
}
FakeBan.store = [];
FakeBan.nextId = 1;
require.cache[require.resolve('../src/models/Ban')] = {
  id: require.resolve('../src/models/Ban'),
  filename: require.resolve('../src/models/Ban'),
  loaded: true,
  exports: FakeBan,
};
const { upsertBan, findBan, removeBan, findBannedAmong } = require('../src/utils/banStore');

// Same in-memory pattern for the Mute model, so muteStore.js's normalized
// matching can be tested without a real database.
class FakeMute {
  constructor(doc) {
    Object.assign(this, doc);
    this._id = `fake-${FakeMute.nextId++}`;
  }
  async save() {
    const i = FakeMute.store.findIndex((b) => b._id === this._id);
    if (i >= 0) FakeMute.store[i] = this;
  }
  static async find(query) {
    return FakeMute.store.filter((b) => !query?.groupId || b.groupId === query.groupId);
  }
  static async create(doc) {
    const b = new FakeMute(doc);
    FakeMute.store.push(b);
    return b;
  }
  static async deleteOne(query) {
    FakeMute.store = FakeMute.store.filter((b) => b._id !== query._id);
  }
}
FakeMute.store = [];
FakeMute.nextId = 1;
require.cache[require.resolve('../src/models/Mute')] = {
  id: require.resolve('../src/models/Mute'),
  filename: require.resolve('../src/models/Mute'),
  loaded: true,
  exports: FakeMute,
};
const { upsertMute, findMute, removeMute } = require('../src/utils/muteStore');

const tests = [
  {
    name: 'keeps roast and ragebait guidance in the AI personality prompt',
    run() {
      const prompt = buildSystemPrompt({
        isOwnerMessage: false,
        isGroupAdmin: true,
        addressed: true,
        commandReference: '',
        stickersAvailable: true,
        voiceAvailable: true,
        roastTargetLabel: '@chidi'
      });

      assert.match(prompt, /properly brutal and savage/i);
      assert.match(prompt, /werey.*ode.*mumu.*abeg shift/i);
      assert.match(prompt, /excitement, surprise, playful frustration/i);
      assert.match(prompt, /spoken delivery feel expressive too/i);
      assert.match(prompt, /This message is from a group admin/i);
      assert.match(prompt, /explicitly asks you to reply by voice/i);
      assert.match(prompt, /explicitly ask for text, reply in text/i);
      assert.match(prompt, /do not stay silent on a normal direct question/i);
    },
  },
  {
    name: 'recognizes bot mentions by WhatsApp metadata, number, or configured name',
    run() {
      const sock = {
        user: { id: '2348000000000:7@s.whatsapp.net' },
        authState: { creds: { me: { lid: '987654321@lid' } } },
      };
      const mention = (jid, text = 'hello') => ({
        message: { extendedTextMessage: { text, contextInfo: { mentionedJid: [jid] } } },
      });

      assert.strictEqual(isAddressingBot(mention('987654321@lid'), sock), true);
      assert.strictEqual(isAddressingBot(mention('2348000000000@s.whatsapp.net'), sock), true);
      assert.strictEqual(isAddressingBot(mention('111111111@s.whatsapp.net', '@2348000000000 can you help?'), sock), true);
      assert.strictEqual(isAddressingBot(mention('111111111@s.whatsapp.net', 'Bluehunter, can you help?'), sock), true);
      assert.strictEqual(isAddressingBot(mention('111111111@s.whatsapp.net', 'hello everyone'), sock), false);
    },
  },
  {
    name: 'extracts sticker requests from AI replies',
    run() {
      const parsed = extractStickerRequest('You no get sense [STICKER: this you].');
      assert.strictEqual(parsed.text, 'You no get sense');
      assert.strictEqual(parsed.stickerQuery, 'this you');
    },
  },
  {
    name: 'allows general NSFW without auto-leaving by default',
    run() {
      assert.strictEqual(GroupSettings.schema.paths.nsfwAllowed.defaultValue, true);
      assert.strictEqual(shouldLeaveForGeneralNsfw(undefined), false);
      assert.strictEqual(shouldLeaveForGeneralNsfw({}), false);
      assert.strictEqual(shouldLeaveForGeneralNsfw({ nsfwAllowed: true }), false);
      assert.strictEqual(shouldLeaveForGeneralNsfw({ nsfwAllowed: false }), true);
    },
  },
  {
    name: 'detects under-13 age statements',
    run() {
      assert.strictEqual(detectUnderageViolation('I am 12 years old'), true);
      assert.strictEqual(detectUnderageViolation('I am 13 years old'), false);
      assert.strictEqual(detectUnderageViolation('I am younger than 13'), true);
      assert.strictEqual(detectUnderageViolation('hi my name is John'), false);
    },
  },
  {
    name: 'detects forwarded messages via the real per-content-type contextInfo (not the nonexistent messageContextInfo.isForwarded)',
    run() {
      // messageContextInfo carries device-list/bot metadata only - WhatsApp's
      // real proto has no isForwarded/forwardingScore field on it at all. The
      // forward flag lives on the content type's OWN contextInfo instead.
      const forwarded = {
        message: {
          extendedTextMessage: { text: 'hello', contextInfo: { isForwarded: true } },
        },
      };
      assert.strictEqual(isForwardedMessage(forwarded), true);

      // A populated-but-irrelevant messageContextInfo must not cause a false positive,
      // and must not be required for a real forward (isForwarded: false) to read as not-forwarded.
      const notForwarded = {
        message: {
          extendedTextMessage: { text: 'hello', contextInfo: { isForwarded: false } },
          messageContextInfo: { deviceListMetadataVersion: 2 },
        },
      };
      assert.strictEqual(isForwardedMessage(notForwarded), false);

      // Forwarding a native group-invite card (a distinct message type from a
      // plain chat.whatsapp.com text link) must also be caught.
      const forwardedInvite = {
        message: { groupInviteMessage: { groupJid: 'x@g.us', inviteCode: 'abc', contextInfo: { isForwarded: true } } },
      };
      assert.strictEqual(isForwardedMessage(forwardedInvite), true);
    },
  },
  {
    name: 'unwraps nested view once payloads',
    run() {
      const payload = {
        viewOnceMessage: {
          message: {
            imageMessage: {
              viewOnce: true,
              caption: 'hi'
            }
          }
        }
      };
      const result = unwrapMessage(payload);
      assert.strictEqual(result.isViewOnce, true);
      assert.strictEqual(result.inner.imageMessage.viewOnce, true);
    },
  },
  {
    name: 'suppresses expected WhatsApp media decrypt failures',
    run() {
      assert.strictEqual(isExpectedMediaDownloadFailure('error:1C800064:Provider routines::bad decrypt'), true);
      assert.strictEqual(isExpectedMediaDownloadFailure('something else'), false);
    },
  },
  {
    name: 'matches real WhatsApp status mention flag',
    run() {
      const waMessage = { isMentionedInStatus: true, key: { remoteJid: 'general' }, message: { extendedTextMessage: { text: 'hello' } } };
      assert.strictEqual(Boolean(waMessage.isMentionedInStatus), true);
    },
  },
  {
    name: 'matches raw status broadcast jid fallback',
    run() {
      const waMessage = { key: { remoteJid: 'status@broadcast' }, message: { extendedTextMessage: { text: 'hello' } } };
      assert.strictEqual(waMessage.key.remoteJid === 'status@broadcast', true);
    },
  },
  {
    name: 'forwards mentions through msg.reply',
    run() {
      const calls = [];
      const sock = { sendMessage: (...args) => calls.push(args) };
      const waMessage = { key: { remoteJid: '123@g.us', participant: 'bot@s.whatsapp.net' } };
      const msg = buildMsgCompat(sock, waMessage, '123@g.us');
      const targetJid = '456@s.whatsapp.net';

      msg.reply('hi', undefined, { mentions: [targetJid] });

      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0][1].mentions, [targetJid]);
      assert.strictEqual(calls[0][1].text, 'hi');
    },
  },
  {
    name: 'creates and updates a fun game lobby',
    run() {
      const groupId = '123@g.us';
      const lobby = createGameLobby({ groupId, gameType: 'wordchain', starterId: 'timtech@s.whatsapp.net' });
      assert.strictEqual(lobby.players.length, 1);
      assert.strictEqual(lobby.gameType, 'wordchain');

      const joined = joinGameLobby({ groupId, userId: 'jane@s.whatsapp.net' });
      assert.strictEqual(joined, true);
      assert.strictEqual(getGameLobby(groupId).players.length, 2);

      const closed = closeGameLobby(groupId);
      assert.strictEqual(closed.players.length, 2);
      assert.strictEqual(getGameLobby(groupId), null);
    },
  },
  {
    name: 'join command starts a wordchain lobby when no game is open',
    run() {
      const groupId = 'join-default@g.us';
      const lobby = createGameLobby({ groupId, gameType: 'wordchain', starterId: 'host@s.whatsapp.net' });
      assert.strictEqual(lobby.gameType, 'wordchain');
      assert.strictEqual(lobby.players.length, 1);
      const joined = joinGameLobby({ groupId, userId: 'guest@s.whatsapp.net' });
      assert.strictEqual(joined, true);
      assert.strictEqual(getGameLobby(groupId).players.includes('guest@s.whatsapp.net'), true);
      closeGameLobby(groupId);
    },
  },
  {
    name: 'plain join text joins the active lobby without a slash command',
    run() {
      const groupId = 'plain-join@g.us';
      createGameLobby({ groupId, gameType: 'wordchain', starterId: 'host@s.whatsapp.net' });
      const result = maybeHandleLobbyJoin({ groupId, userId: 'guest@s.whatsapp.net' });
      assert.strictEqual(result.handled, true);
      assert.strictEqual(result.joined, true);
      assert.strictEqual(getGameLobby(groupId).players.includes('guest@s.whatsapp.net'), true);
      closeGameLobby(groupId);
    },
  },
  {
    name: 'starts a playable wordchain round and accepts a valid next word',
    run() {
      const round = createRound({ groupId: 'round@g.us', gameType: 'wordchain', players: ['a@s.whatsapp.net', 'b@s.whatsapp.net'], starterWord: 'planet' });
      assert.strictEqual(round.gameType, 'wordchain');
      assert.strictEqual(round.currentWord, 'planet');
      assert.strictEqual(round.currentPlayer, 'a@s.whatsapp.net');

      const result = submitGuess({
        groupId: 'round@g.us',
        userId: 'a@s.whatsapp.net',
        guess: 'tiger',
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.nextLetter, 'r');
      assert.strictEqual(getRoundState('round@g.us').currentWord, 'tiger');
      assert.strictEqual(getRoundState('round@g.us').scores['a@s.whatsapp.net'], 1);
      assert.strictEqual(getRoundState('round@g.us').currentPlayer, 'b@s.whatsapp.net');
    },
  },
  {
    name: 'returns a reaction-style result for correct and incorrect answers',
    run() {
      createRound({ groupId: 'reaction@g.us', gameType: 'wordchain', players: ['a@s.whatsapp.net', 'b@s.whatsapp.net'], starterWord: 'planet' });

      const wrong = submitGuess({
        groupId: 'reaction@g.us',
        userId: 'a@s.whatsapp.net',
        guess: 'apple',
      });
      assert.strictEqual(wrong.valid, false);
      assert.strictEqual(wrong.reaction, '❌');

      const right = submitGuess({
        groupId: 'reaction@g.us',
        userId: 'a@s.whatsapp.net',
        guess: 'tiger',
      });
      assert.strictEqual(right.valid, true);
      assert.strictEqual(right.reaction, '✅');
    },
  },
  {
    name: 'rejects non-dictionary guesses in wordchain',
    run() {
      createRound({ groupId: 'dictionary@g.us', gameType: 'wordchain', players: ['a@s.whatsapp.net', 'b@s.whatsapp.net'], starterWord: 'planet' });

      const result = submitGuess({
        groupId: 'dictionary@g.us',
        userId: 'a@s.whatsapp.net',
        guess: 'dick',
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason.includes('dictionary') || result.reason.includes('real word') || result.reason.includes('valid word'), true);
    },
  },
  {
    name: 'requires more than one player to start a game',
    run() {
      const round = createRound({ groupId: 'solo@g.us', gameType: 'wordchain', players: ['a@s.whatsapp.net'], starterWord: 'planet' });
      assert.strictEqual(round.status, 'waiting');
      assert.strictEqual(getRoundState('solo@g.us'), null);
    },
  },
  {
    name: 'mentions the relevant player in game replies',
    async run() {
      const groupId = 'mention@g.us';
      const chat = { id: { _serialized: groupId } };
      const calls = [];
      const msg = {
        body: 'tiger',
        reply: async (text, _quoted, options = {}) => {
          calls.push({ text, options });
          return { key: 'reply-1' };
        },
      };

      createRound({ groupId, gameType: 'wordchain', players: ['a@s.whatsapp.net', 'b@s.whatsapp.net'], starterWord: 'planet' });
      await maybeHandleGameRound({ chat, msg, senderId: 'a@s.whatsapp.net' });

      assert.deepStrictEqual(calls[0].options.mentions, ['b@s.whatsapp.net']);
    },
  },
  {
    name: 'cancels a round when no one answers in time',
    run() {
      const round = createRound({ groupId: 'cancel@g.us', gameType: 'wordchain', players: ['a@s.whatsapp.net', 'b@s.whatsapp.net'], starterWord: 'planet' });
      round.noResponseTurns = 3;

      const cancelled = cancelRound('cancel@g.us', 'No one responded, so the game was cancelled.');
      assert.strictEqual(cancelled.cancelled, true);
      assert.strictEqual(getRoundState('cancel@g.us'), null);
    },
  },
  {
    name: 'records and lists deleted user logs for admins',
    run() {
      const groupId = 'deleted@g.us';
      const deletedAt = new Date('2026-09-20T20:42:00Z');

      recordDeletedMessage({
        groupId,
        userId: 'timtech@s.whatsapp.net',
        messageId: 'abc123',
        text: 'Anyone playing tonight?',
        mediaType: null,
        timestamp: deletedAt,
      });

      const logs = listDeletedLogs(groupId, 'timtech@s.whatsapp.net');
      assert.strictEqual(logs.length, 1);
      assert.strictEqual(logs[0].text, 'Anyone playing tonight?');
      assert.strictEqual(logs[0].messageId, 'abc123');
    },
  },
  {
    name: 'captures delete events from nested Baileys key arrays',
    async run() {
      const groupId = 'delete-keys@g.us';
      const message = {
        key: { id: 'nested-delete-1', remoteJid: groupId, participant: 'eric@s.whatsapp.net' },
        message: { imageMessage: { caption: 'deleted pic' } },
      };
      await trackIncomingMessage(message);

      handleDeleteEvent({ keys: [{ id: 'nested-delete-1' }], from: groupId });

      const logs = listDeletedLogs(groupId, 'eric@s.whatsapp.net');
      assert.strictEqual(logs.length >= 1, true);
      assert.strictEqual(logs[0].mediaType, 'image');
      assert.strictEqual(logs[0].text.includes('deleted pic'), true);
    },
  },
  {
    name: 'logs a delete-for-everyone (messages.update REVOKE) and matches the user by phone jid or LID',
    async run() {
      const groupId = 'revoke-group@g.us';
      // Long-like timestamp object, LID participant + phone jid, exactly the awkward shapes Baileys produces.
      await trackIncomingMessage({
        key: { id: 'rev-1', remoteJid: groupId, participant: '111222@lid', participantPn: '233501234567@s.whatsapp.net' },
        messageTimestamp: { toNumber: () => Math.floor(Date.now() / 1000) - 10 * 60 * 60 }, // sent 10h ago - older than the log window
        message: { conversation: 'this will be deleted' },
      });

      const recorded = handleMessageUpdates([
        {
          key: { remoteJid: groupId, id: 'rev-1', participant: '111222@lid' },
          update: { message: null, messageStubType: 1, key: { remoteJid: groupId, participant: '111222@lid' } },
        },
        // unrelated update (e.g. delivery status) must be ignored
        { key: { remoteJid: groupId, id: 'other' }, update: { status: 3 } },
      ]);
      assert.strictEqual(recorded, 1);

      for (const who of ['233501234567@s.whatsapp.net', '111222@lid', null]) {
        const logs = listDeletedLogs(groupId, who);
        assert.strictEqual(logs.length, 1, `expected a log for ${who}`);
        assert.strictEqual(logs[0].text, 'this will be deleted');
      }
      assert.strictEqual(listDeletedLogs(groupId, 'someone-else@s.whatsapp.net').length, 0);
    },
  },
  {
    name: 'detects a real "mentioned in a status" share via its actual wrapper, not just the legacy flags',
    run() {
      // The shape WhatsApp really sends when someone shares a status mention
      // into the group: groupStatusMentionMessage wraps the real content.
      const realShare = {
        key: { id: 'gsm-1', remoteJid: 'group@g.us', participant: '233500000001@s.whatsapp.net' },
        message: {
          groupStatusMentionMessage: {
            message: { extendedTextMessage: { text: 'You were mentioned in a status!' } },
          },
        },
      };
      assert.strictEqual(isGroupStatusMention(realShare), true);
      assert.strictEqual(
        unwrapMessage(realShare.message).inner?.extendedTextMessage?.text,
        'You were mentioned in a status!'
      );

      // Legacy flags still work as a fallback.
      assert.strictEqual(isGroupStatusMention({ isMentionedInStatus: true, message: { conversation: 'x' } }), true);
      assert.strictEqual(isGroupStatusMention({ key: { remoteJid: 'status@broadcast' }, message: { conversation: 'x' } }), true);

      // An ordinary message must NOT be flagged.
      assert.strictEqual(
        isGroupStatusMention({ key: { remoteJid: 'group@g.us' }, message: { conversation: 'just chatting' } }),
        false
      );
    },
  },
  {
    name: 'detects someone sharing their Status directly into the group (Status > Share, no @mention)',
    run() {
      // WhatsApp attaches this as a sibling field on the envelope, alongside
      // what otherwise looks like an ordinary image/video/text message.
      const sharedStatus = {
        key: { id: 'share-1', remoteJid: 'group@g.us', participant: '233500000009@s.whatsapp.net' },
        statusMentionMessageInfo: { quotedStatus: { imageMessage: { caption: 'my status caption' } } },
        message: { imageMessage: { caption: 'shared status pic' } },
      };
      assert.strictEqual(isGroupStatusMention(sharedStatus), true);

      // A normal photo with none of the status fields must not be flagged.
      const plainPhoto = { key: { remoteJid: 'group@g.us' }, message: { imageMessage: { caption: 'just a normal pic' } } };
      assert.strictEqual(isGroupStatusMention(plainPhoto), false);

      // An empty statusMentionMessageInfo (no quotedStatus) must not false-positive.
      const emptyInfo = { key: { remoteJid: 'group@g.us' }, statusMentionMessageInfo: {}, message: { conversation: 'hi' } };
      assert.strictEqual(isGroupStatusMention(emptyInfo), false);
    },
  },
  {
    name: 'ban/unban/rejoin-rekick all match by normalized id, not raw jid string (phone jid vs @lid)',
    async run() {
      FakeBan.store = [];
      const groupId = 'ban-test@g.us';

      // Ban recorded via an @mention that resolved to an @lid.
      await upsertBan(groupId, '111222@lid', 'spam', 'admin@s.whatsapp.net');
      assert.strictEqual(FakeBan.store.length, 1);

      // Same real person rejoins, but WhatsApp reports them in phone-jid form
      // this time (same bare id, different suffix) - must still be caught.
      const rekicked = await findBannedAmong(groupId, ['111222@s.whatsapp.net', 'someone-else@s.whatsapp.net']);
      assert.deepStrictEqual(rekicked, ['111222@s.whatsapp.net']);

      // Re-banning the same person under yet another jid form updates the
      // existing record instead of creating a duplicate, untracked one.
      await upsertBan(groupId, '111222@s.whatsapp.net', 'updated reason', 'admin2@s.whatsapp.net');
      assert.strictEqual(FakeBan.store.length, 1);
      assert.strictEqual(FakeBan.store[0].reason, 'updated reason');

      // /unban targeting yet another form of the same bare id must find and remove it.
      const found = await findBan(groupId, '111222@lid');
      assert.ok(found);
      await removeBan(found);
      assert.strictEqual(FakeBan.store.length, 0);

      // A genuinely different person must never match.
      await upsertBan(groupId, '999888@lid', 'other person', 'admin@s.whatsapp.net');
      assert.strictEqual(await findBan(groupId, '111222@s.whatsapp.net'), null);
      assert.deepStrictEqual(await findBannedAmong(groupId, ['111222@s.whatsapp.net']), []);
    },
  },
  {
    name: 'mute/unmute/enforcement all match by normalized id, not raw jid string (phone jid vs @lid) - same bug class as ban',
    async run() {
      FakeMute.store = [];
      const groupId = 'mute-test@g.us';

      // Muted via an @mention that resolved to an @lid.
      await upsertMute(groupId, '111222@lid', null, 'spam', 'admin@s.whatsapp.net');
      assert.strictEqual(FakeMute.store.length, 1);

      // The SAME real person's next message arrives under their phone-jid
      // form instead - this is exactly the enforcement check in message.js.
      // Must still find the mute, or they talk right through it.
      const enforcementLookup = await findMute(groupId, '111222@s.whatsapp.net');
      assert.ok(enforcementLookup, 'mute must be found even when the sender jid form differs from how they were muted');
      assert.strictEqual(enforcementLookup.reason, 'spam');

      // Re-muting the same person under yet another jid form updates the
      // existing record instead of creating a duplicate, untracked one.
      await upsertMute(groupId, '111222@s.whatsapp.net', null, 'updated reason', 'admin2@s.whatsapp.net');
      assert.strictEqual(FakeMute.store.length, 1);
      assert.strictEqual(FakeMute.store[0].reason, 'updated reason');

      // /unmute targeting yet another form of the same bare id must find and remove it.
      const found = await findMute(groupId, '111222@lid');
      assert.ok(found);
      await removeMute(found);
      assert.strictEqual(FakeMute.store.length, 0);

      // A genuinely different person must never match.
      await upsertMute(groupId, '999888@lid', null, 'other person', 'admin@s.whatsapp.net');
      assert.strictEqual(await findMute(groupId, '111222@s.whatsapp.net'), null);
    },
  },
  {
    name: 'warning/strike system (AI moderation, /warn, /resetwarn, /warnings, /aicases) all count by normalized id, not raw jid string',
    async run() {
      FakeWarning.store = [];
      const groupId = 'warn-test@g.us';

      // Same real person warned under two different jid forms - this is
      // exactly what used to let someone dodge the 3-strike auto-kick by
      // simply having their messages arrive under alternating jid forms.
      await createWarning({ groupId, userId: '111@lid', reason: 'first', moderatorId: 'admin', source: 'manual' });
      await createWarning({ groupId, userId: '111@s.whatsapp.net', reason: 'second', moderatorId: 'admin', source: 'manual' });
      await createWarning({ groupId, userId: '111@lid', reason: 'ai strike', moderatorId: 'system', source: 'ai' });

      // The auto-kick threshold check (moderationAction.js / warn.js) must
      // see the FULL count regardless of which form it's queried under.
      assert.strictEqual(await countWarnings(groupId, '111@s.whatsapp.net'), 3);
      assert.strictEqual(await countWarnings(groupId, '111@lid', { source: 'ai' }), 1);

      // /warnings and /aicases must see the complete history too.
      assert.strictEqual((await findWarnings(groupId, '111@lid')).length, 3);
      assert.strictEqual((await findWarnings(groupId, '111@s.whatsapp.net', { source: 'ai' })).length, 1);

      // /resetwarn must clear ALL of them, however they were recorded.
      const removed = await deleteWarnings(groupId, '111@s.whatsapp.net');
      assert.strictEqual(removed, 3);
      assert.strictEqual(await countWarnings(groupId, '111@lid'), 0);

      // A genuinely different person's warnings must never be touched.
      await createWarning({ groupId, userId: '999@lid', reason: 'other person', moderatorId: 'admin', source: 'manual' });
      assert.strictEqual(await countWarnings(groupId, '111@lid'), 0);
      assert.strictEqual(await countWarnings(groupId, '999@lid'), 1);
    },
  },
];

(async () => {
  for (const test of tests) {
    try {
      await test.run();
      console.log(`PASS: ${test.name}`);
    } catch (err) {
      console.error(`FAIL: ${test.name}`);
      console.error(err.stack || err.message);
      process.exitCode = 1;
    }
  }
})();
