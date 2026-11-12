const assert = require('node:assert/strict');
const { test } = require('node:test');
const { proto } = require('@whiskeysockets/baileys');

const { sendSocialAlert, GROUP_STATUS_DESTINATION } = require('../src/utils/socialAlertDelivery');

test('social alerts continue to use the group chat by default', async () => {
  const sent = [];
  const sock = { async sendMessage(...args) { sent.push(args); } };
  const content = { text: 'New post' };

  await sendSocialAlert(sock, { groupId: 'alerts@g.us' }, content);

  assert.deepEqual(sent, [['alerts@g.us', content]]);
});

test('Group Status alerts use Baileys relay with a group-status envelope', async () => {
  const sent = [];
  const sock = {
    user: { id: 'bot@s.whatsapp.net' },
    async relayMessage(...args) {
      sent.push(args);
      return args[2].messageId;
    },
  };

  await sendSocialAlert(
    sock,
    { groupId: 'alerts@g.us', destination: GROUP_STATUS_DESTINATION },
    { text: 'New post from X' }
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'alerts@g.us');
  const [groupId, message, options] = sent[0];
  assert.equal(groupId, 'alerts@g.us');
  const decoded = proto.Message.decode(proto.Message.encode(message).finish());
  assert.equal(decoded.groupStatusMessage.message.extendedTextMessage.text, 'New post from X');
  assert.equal(decoded.messageContextInfo.messageSecret.length, 32);
  assert.deepEqual(options.additionalNodes, [{
    tag: 'meta',
    attrs: { is_group_status: 'true', origin: 'group_status' },
  }]);
  assert.equal(options.useCachedGroupMetadata, false);
  assert.ok(options.messageId);
});

test('Group Status delivery rejects non-group targets or missing relay support', async () => {
  const watch = { groupId: 'not-a-group@s.whatsapp.net', destination: GROUP_STATUS_DESTINATION };
  await assert.rejects(
    sendSocialAlert({ user: { id: 'bot@s.whatsapp.net' } }, watch, { text: 'New post' }),
    /require a WhatsApp group JID/
  );

  await assert.rejects(
    sendSocialAlert({ user: { id: 'bot@s.whatsapp.net' } }, { ...watch, groupId: 'alerts@g.us' }, { text: 'New post' }),
    /cannot relay Group Status/
  );
});
