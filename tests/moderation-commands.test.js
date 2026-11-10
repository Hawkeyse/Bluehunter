const assert = require('node:assert/strict');
const { test } = require('node:test');

const clearCommand = require('../src/commands/chatcontrol/clear');
const delCommand = require('../src/commands/moderation/del');
const { trackIncomingMessage } = require('../src/utils/deletedLogs');
const { isGroupStatusMention, unwrapMessage } = require('../src/utils/mediaContent');

function makeChat(groupId) {
  return {
    id: { _serialized: groupId },
    isGroup: true,
    participants: [{ id: { _serialized: 'bot@s.whatsapp.net' }, isAdmin: true, isSuperAdmin: false }],
    async clearMessages() {},
  };
}

function makeMessage({ groupId, target, args = [], body = '/clear' }) {
  const replies = [];
  return {
    from: groupId,
    body,
    async getMentions() {
      return target ? [{ id: { _serialized: target } }] : [];
    },
    async reply(text) {
      replies.push(text);
    },
    _raw: { message: { extendedTextMessage: { text: body } } },
    replies,
    args,
  };
}

test('group status without a mention is detected and unwrapped', () => {
  const raw = {
    key: { remoteJid: 'status-share@g.us' },
    message: { groupStatusMessage: { message: { imageMessage: { caption: 'group update' } } } },
  };

  assert.equal(isGroupStatusMention(raw), true);
  assert.equal(unwrapMessage(raw.message).inner.imageMessage.caption, 'group update');
});

test('/clear @user N deletes only that user’s recent messages', async () => {
  const groupId = 'clear-command-test@g.us';
  const target = '233555555555@s.whatsapp.net';
  for (const [id, participant, second] of [
    ['clear-target-1', '123@lid', 1],
    ['clear-other', '456@lid', 2],
    ['clear-target-2', '123@lid', 3],
  ]) {
    await trackIncomingMessage({
      key: { id, remoteJid: groupId, participant, participantPn: participant === '123@lid' ? target : '233666666666@s.whatsapp.net' },
      messageTimestamp: Date.now() - second * 1000,
      message: { conversation: id },
    });
  }

  const deletes = [];
  const client = {
    user: { id: 'bot@s.whatsapp.net' },
    async sendMessage(jid, payload) {
      deletes.push({ jid, key: payload.delete });
    },
  };
  const msg = makeMessage({ groupId, target, args: ['10'] });

  await clearCommand.execute({
    client,
    msg,
    chat: makeChat(groupId),
    args: ['10'],
    senderId: 'admin@s.whatsapp.net',
  });

  assert.equal(deletes.length, 2);
  assert.deepEqual(deletes.map((entry) => entry.key.id).sort(), ['clear-target-1', 'clear-target-2']);
  assert.match(msg.replies[0], /Deleted 2 of 2 messages/);

  await clearCommand.execute({
    client,
    msg,
    chat: makeChat(groupId),
    args: ['10'],
    senderId: 'admin@s.whatsapp.net',
  });
  assert.equal(deletes.length, 2);
  assert.match(msg.replies[1], /no recent messages/i);
});

test('/del deletes the message replied to', async () => {
  const groupId = 'del-command-test@g.us';
  const target = '123@lid';
  const messageId = 'reply-to-delete';
  await trackIncomingMessage({
    key: { id: messageId, remoteJid: groupId, participant: target },
    message: { conversation: 'remove this' },
  });

  const sent = [];
  const client = {
    user: { id: 'bot@s.whatsapp.net' },
    async sendMessage(jid, payload) {
      sent.push({ jid, key: payload.delete });
    },
  };
  const msg = makeMessage({ groupId, target: null, body: '/del' });
  msg._raw.message.extendedTextMessage.contextInfo = { stanzaId: messageId, participant: target };

  await delCommand.execute({
    client,
    msg,
    chat: makeChat(groupId),
    senderId: 'admin@s.whatsapp.net',
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, groupId);
  assert.equal(sent[0].key.id, messageId);
  assert.equal(msg.replies[0], '🗑️ Message deleted.');
});
