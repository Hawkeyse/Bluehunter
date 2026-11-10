const assert = require('node:assert/strict');
const { test } = require('node:test');

const serverPath = require.resolve('../src/web/server');
const permissionsPath = require.resolve('../src/utils/permissions');
const loggerPath = require.resolve('../src/utils/logger');
require.cache[serverPath] = {
  id: serverPath,
  filename: serverPath,
  loaded: true,
  exports: { issueCode: () => 'ABCD-EFGH', webEnabled: () => true, webUrl: () => 'https://example.test' },
};
require.cache[permissionsPath] = {
  id: permissionsPath,
  filename: permissionsPath,
  loaded: true,
  exports: { resolveNumber: async () => null },
};
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { info() {}, warn() {} },
};

const command = require('../src/commands/general/verify');

function setup({ args = [], group = true, sendMessage = async () => {} } = {}) {
  const sent = [];
  const replies = [];
  const client = {
    async sendMessage(...call) {
      sent.push(call);
      return sendMessage(...call);
    },
  };
  const msg = {
    _raw: { key: { participantPn: '2348000000000@s.whatsapp.net' } },
    async reply(text) {
      replies.push(text);
    },
  };
  const chat = {
    isGroup: group,
    id: { _serialized: group ? 'group@g.us' : 'user@s.whatsapp.net' },
    participants: [],
  };
  return { client, msg, chat, args, senderId: group ? 'user@lid' : '2348000000000@s.whatsapp.net', sent, replies };
}

test('sends group verification codes to DM and only acknowledges in the group', async () => {
  const ctx = setup();
  await command.execute(ctx);

  assert.ok(ctx.sent.length > 0);
  assert.ok(ctx.sent.every(([jid]) => jid !== 'group@g.us'));
  assert.equal(ctx.sent[0][0], '2348000000000@s.whatsapp.net');
  assert.match(ctx.sent[0][1].text, /ABCD-EFGH/);
  assert.equal(ctx.replies.length, 1);
  assert.doesNotMatch(ctx.replies[0], /ABCD-EFGH/);
});

test('does not expose a code in the group when private delivery fails', async () => {
  const ctx = setup({ sendMessage: async () => { throw new Error('DM unavailable'); } });
  await command.execute(ctx);

  assert.ok(ctx.sent.length > 0);
  assert.ok(ctx.sent.every(([jid]) => jid !== 'group@g.us'));
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0], /could not deliver your login code privately/i);
  assert.doesNotMatch(ctx.replies[0], /ABCD-EFGH/);
});

test('posts the code in the group only after an explicit /verify here', async () => {
  const ctx = setup({ args: ['here'] });
  await command.execute(ctx);

  assert.equal(ctx.sent.length, 0);
  assert.match(ctx.replies[0], /ABCD-EFGH/);
  assert.match(ctx.replies[0], /Posted here/i);
});

test('a verification request sent in DM replies privately', async () => {
  const ctx = setup({ group: false });
  await command.execute(ctx);

  assert.equal(ctx.sent.length, 0);
  assert.match(ctx.replies[0], /ABCD-EFGH/);
});
