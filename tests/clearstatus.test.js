const assert = require('node:assert/strict');
const { test } = require('node:test');

const storedStatuses = new Map();
let botIsAdmin = true;
let failDeleteIds = new Set();
let adminIds = new Set(['admin@s.whatsapp.net']);

function mockModule(relativePath, exports) {
  const id = require.resolve(relativePath);
  const previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  return () => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  };
}

const restore = [
  mockModule('../src/models/GroupStatusPost', {
    async findOneAndUpdate(query, update) {
      storedStatuses.set(`${query.groupId}:${query.messageId}`, {
        ...query,
        ...update.$set,
      });
    },
    find(query) {
      let results = [...storedStatuses.values()].filter(
        (entry) => entry.groupId === query.groupId && entry.expiresAt > query.expiresAt.$gt
      );
      return {
        sort() { return this; },
        async lean() { return results; },
      };
    },
    async deleteOne(query) {
      storedStatuses.delete(`${query.groupId}:${query.messageId}`);
    },
  }),
  mockModule('../src/utils/permissions', {
    isGroupAdmin: async (_client, _chat, authorId) => adminIds.has(authorId),
    isBotAdmin: () => botIsAdmin,
  }),
  mockModule('../src/utils/logger', { warn() {} }),
];

const {
  trackGroupStatus,
  getTrackedGroupStatuses,
} = require('../src/utils/groupStatusStore');
const clearStatusCommand = require('../src/commands/groupcontrol/clearstatus');

function statusMessage(groupId, id, participant) {
  return {
    key: {
      remoteJid: groupId,
      id,
      participant,
      ...(participant ? { participantPn: `${id}-phone@s.whatsapp.net` } : {}),
      fromMe: false,
    },
    message: { groupStatusMessage: { message: { imageMessage: {} } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

test('tracks groupStatusMessage posts with their original Baileys key', async () => {
  const groupId = 'clearstatus-track@g.us';
  const memberStatus = statusMessage(groupId, 'member-status', 'member@s.whatsapp.net');
  await trackGroupStatus(memberStatus);
  await trackGroupStatus(statusMessage(groupId, 'admin-status', 'admin@s.whatsapp.net'));
  await trackGroupStatus({
    ...statusMessage(groupId, 'plain-message', 'member@s.whatsapp.net'),
    message: { conversation: 'ordinary group message' },
  });
  await trackGroupStatus({
    ...statusMessage(groupId, 'own-status', 'bot@s.whatsapp.net'),
    key: { ...statusMessage(groupId, 'own-status', 'bot@s.whatsapp.net').key, fromMe: true },
  });
  await trackGroupStatus({
    ...statusMessage('status@broadcast', 'unrelated-status', 'member@s.whatsapp.net'),
  });

  const tracked = await getTrackedGroupStatuses(groupId);
  assert.deepEqual(tracked.map((entry) => entry.messageId), ['member-status', 'admin-status']);
  assert.deepEqual(tracked[0].key, memberStatus.key);

  const storePath = require.resolve('../src/utils/groupStatusStore');
  delete require.cache[storePath];
  const restartedStore = require('../src/utils/groupStatusStore');
  assert.deepEqual(
    (await restartedStore.getTrackedGroupStatuses(groupId)).map((entry) => entry.messageId),
    ['member-status', 'admin-status']
  );
});

test('does not mistake a status mention/share for a group Status post', async () => {
  const groupId = 'clearstatus-mention@g.us';
  await trackGroupStatus({
    ...statusMessage(groupId, 'status-mention', 'member@s.whatsapp.net'),
    message: { extendedTextMessage: { text: 'Status' } },
    statusMentionMessageInfo: { quotedStatus: { videoMessage: {} } },
  });

  assert.deepEqual(await getTrackedGroupStatuses(groupId), []);
});

test('clearstatus deletes multiple non-admin posts while preserving admin and unknown-author posts', async () => {
  const groupId = 'clearstatus-run@g.us';
  await trackGroupStatus(statusMessage(groupId, 'member-status-1', 'member@s.whatsapp.net'));
  await trackGroupStatus(statusMessage(groupId, 'member-status-2', 'member2@s.whatsapp.net'));
  await trackGroupStatus(statusMessage(groupId, 'admin-status', 'admin@s.whatsapp.net'));
  await trackGroupStatus(statusMessage(groupId, 'unknown-status', ''));

  const deleted = [];
  const replies = [];
  const initialStatuses = await getTrackedGroupStatuses(groupId);
  await clearStatusCommand.execute({
    client: {
      async sendMessage(jid, content) {
        deleted.push({ jid, key: content.delete });
      },
    },
    msg: { async reply(text) { replies.push(text); } },
    chat: { id: { _serialized: groupId }, participants: [] },
  });

  assert.deepEqual(deleted.map(({ key }) => key.id), ['member-status-1', 'member-status-2']);
  assert.ok(deleted.every(({ jid }) => jid === groupId));
  assert.ok(deleted.every(({ key }) => initialStatuses.some((status) => status.key === key || status.key.id === key.id)));
  assert.match(replies[0], /Deleted 2 non-admin Status posts/);
  assert.match(replies[0], /kept 1 admin post/);
  assert.match(replies[0], /Kept 1 post because the author could not be verified/);
  assert.deepEqual(
    (await getTrackedGroupStatuses(groupId)).map((entry) => entry.messageId),
    ['admin-status', 'unknown-status']
  );
});

test('clearstatus reports rejected deletes and keeps those posts available for retry', async () => {
  const groupId = 'clearstatus-failure@g.us';
  await trackGroupStatus(statusMessage(groupId, 'failed-status', 'member@s.whatsapp.net'));
  const replies = [];
  const previousAdminIds = adminIds;
  adminIds = new Set();
  try {
    await clearStatusCommand.execute({
      client: {
        async sendMessage() { throw new Error('WhatsApp rejected delete'); },
      },
      msg: { async reply(text) { replies.push(text); } },
      chat: { id: { _serialized: groupId }, participants: [] },
    });
  } finally {
    adminIds = previousAdminIds;
  }

  assert.match(replies[0], /WhatsApp rejected 1 deletion/);
  assert.equal((await getTrackedGroupStatuses(groupId)).length, 1);
});

test('clearstatus refuses to run when Bluehunter is not a group admin', async () => {
  const replies = [];
  botIsAdmin = false;
  try {
    await clearStatusCommand.execute({
      client: {},
      msg: { async reply(text) { replies.push(text); } },
      chat: { id: { _serialized: 'clearstatus-no-admin@g.us' }, participants: [] },
    });
  } finally {
    botIsAdmin = true;
  }

  assert.match(replies[0], /I need to be a group admin/);
});

test.after(() => {
  for (const restoreModule of restore.reverse()) restoreModule();
});
