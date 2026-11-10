const assert = require('node:assert/strict');
const { test } = require('node:test');

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
  mockModule('../src/utils/permissions', {
    isGroupAdmin: async (_client, _chat, authorId) => authorId === 'admin@s.whatsapp.net',
    isBotAdmin: () => true,
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
    key: { remoteJid: groupId, id, participant, fromMe: false },
    message: { groupStatusMessage: { message: { imageMessage: {} } } },
  };
}

test('only incoming groupStatusMessage posts are tracked', () => {
  const groupId = 'clearstatus-track@g.us';
  trackGroupStatus(statusMessage(groupId, 'member-status', 'member@s.whatsapp.net'));
  trackGroupStatus(statusMessage(groupId, 'admin-status', 'admin@s.whatsapp.net'));
  trackGroupStatus({
    key: { remoteJid: groupId, id: 'plain-message', participant: 'member@s.whatsapp.net' },
    message: { conversation: 'ordinary group message' },
  });
  trackGroupStatus({
    key: { remoteJid: groupId, id: 'own-status', participant: 'bot@s.whatsapp.net', fromMe: true },
    message: { groupStatusMessage: {} },
  });
  trackGroupStatus({
    key: { remoteJid: 'status@broadcast', id: 'unrelated-status', participant: 'member@s.whatsapp.net' },
    message: { groupStatusMessage: {} },
  });

  assert.deepEqual(
    getTrackedGroupStatuses(groupId).map((entry) => entry.key.id),
    ['member-status', 'admin-status']
  );
});

test('clearstatus deletes tracked member posts and keeps admin posts', async () => {
  const groupId = 'clearstatus-run@g.us';
  trackGroupStatus(statusMessage(groupId, 'member-status', 'member@s.whatsapp.net'));
  trackGroupStatus(statusMessage(groupId, 'admin-status', 'admin@s.whatsapp.net'));
  trackGroupStatus(statusMessage(groupId, 'unknown-status', ''));

  const deleted = [];
  const replies = [];
  await clearStatusCommand.execute({
    client: {
      async sendMessage(jid, content) {
        deleted.push({ jid, key: content.delete });
      },
    },
    msg: { async reply(text) { replies.push(text); } },
    chat: { id: { _serialized: groupId }, participants: [] },
  });

  assert.deepEqual(deleted.map(({ key }) => key.id), ['member-status']);
  assert.equal(deleted[0].jid, groupId);
  assert.match(replies[0], /Deleted 1 non-admin Status post/);
  assert.match(replies[0], /kept 1 admin post/);
  assert.match(replies[0], /Kept 1 post because the author could not be verified/);
  assert.deepEqual(
    getTrackedGroupStatuses(groupId).map((entry) => entry.key.id),
    ['admin-status', 'unknown-status']
  );
});

test.after(() => {
  for (const restoreModule of restore.reverse()) restoreModule();
});
