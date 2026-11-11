const assert = require('node:assert/strict');
const { test } = require('node:test');

const settingsPath = require.resolve('../src/models/GroupSettings');
const state = { lastBumpedAt: null, directoryFlairs: [], directoryDiscoverable: false };
const settings = {
  async getOrCreate() {
    return state;
  },
  findOneAndUpdate(filter, update) {
    if (update.$set?.lastBumpedAt) {
      const cutoff = filter.$or.find((condition) => condition.lastBumpedAt?.$lte)?.lastBumpedAt.$lte;
      const eligible = !state.lastBumpedAt || state.lastBumpedAt <= cutoff;
      if (!eligible) return Promise.resolve(null);
      state.lastBumpedAt = update.$set.lastBumpedAt;
      return Promise.resolve(state);
    }
    if (update.directoryFlairs) state.directoryFlairs = update.directoryFlairs;
    if (update.directoryDiscoverable !== undefined) state.directoryDiscoverable = update.directoryDiscoverable;
    return Promise.resolve(state);
  },
  findOne() {
    return { select: () => ({ lean: async () => state }) };
  },
};
require.cache[settingsPath] = {
  id: settingsPath,
  filename: settingsPath,
  loaded: true,
  exports: settings,
};

const bumpCommand = require('../src/commands/analytics/bump');
const discoverableCommand = require('../src/commands/groupcontrol/discoverable');
const flairCommand = require('../src/commands/groupcontrol/flair');

function makeChat() {
  const replies = [];
  return {
    id: { _serialized: 'directory-test@g.us' },
    name: 'Directory test',
    replies,
    async sendMessage(text) {
      replies.push(text);
    },
  };
}

test('/bump sets a persisted timestamp and confirms the directory bump', async () => {
  state.lastBumpedAt = null;
  const chat = makeChat();

  await bumpCommand.execute({ chat });

  assert.ok(state.lastBumpedAt instanceof Date);
  assert.match(chat.replies[0], /bumped in the BlueHunter group directory/i);
});

test('/bump enforces the group-wide 24-hour cooldown', async () => {
  state.lastBumpedAt = new Date();
  const chat = makeChat();

  await bumpCommand.execute({ chat });

  assert.match(chat.replies[0], /bumped recently/i);
  assert.match(chat.replies[0], /try again in/i);
});

test('/discoverable requires a valid state and checks invite access before enabling', async () => {
  state.directoryDiscoverable = false;
  const chat = makeChat();
  await discoverableCommand.execute({
    client: { async groupInviteCode() { return 'sample-code'; } },
    chat,
    args: ['on'],
  });

  assert.equal(state.directoryDiscoverable, true);
  assert.match(chat.replies[0], /now discoverable/i);

  await discoverableCommand.execute({ client: {}, chat, args: ['off'] });
  assert.equal(state.directoryDiscoverable, false);
  assert.match(chat.replies[1], /invite is now hidden/i);
});

test('/discoverable does not publish a group when WhatsApp invite access fails', async () => {
  state.directoryDiscoverable = false;
  const chat = makeChat();

  await discoverableCommand.execute({
    client: { async groupInviteCode() { throw new Error('not authorized'); } },
    chat,
    args: ['on'],
  });

  assert.equal(state.directoryDiscoverable, false);
  assert.match(chat.replies[0], /could not check this group.s invite link/i);
});

test('/flair saves valid labels and rejects conflicting SFW and NSFW labels', async () => {
  state.directoryFlairs = [];
  const chat = makeChat();

  await flairCommand.execute({ chat, args: ['friendly', 'politics'] });
  assert.deepEqual(state.directoryFlairs, ['Friendly', 'Politics']);
  assert.match(chat.replies[0], /self-reported/i);

  await flairCommand.execute({ chat, args: ['sfw', 'nsfw'] });
  assert.deepEqual(state.directoryFlairs, ['Friendly', 'Politics']);
  assert.match(chat.replies[1], /either SFW or NSFW/i);
});

test('/flair accepts multiword, gaming, technology, and country labels with emoji confirmations', async () => {
  state.directoryFlairs = [];
  const chat = makeChat();

  await flairCommand.execute({ chat, args: ['no', 'underage', 'gamer', 'technology', 'south', 'africa'] });

  assert.deepEqual(state.directoryFlairs, ['No underage', 'Gamer', 'Technology', 'South Africa']);
  assert.match(chat.replies[0], /🚫🧒 No underage/);
  assert.match(chat.replies[0], /🎮 Gamer/);
  assert.match(chat.replies[0], /💻 Technology/);
  assert.match(chat.replies[0], /🇿🇦 South Africa/);
});

test('/flair offers emoji labels for active groups, giveaways, and roasts', async () => {
  state.directoryFlairs = [];
  const chat = makeChat();

  await flairCommand.execute({ chat, args: ['active', 'giveaway', 'roast', 'vawulence'] });

  assert.deepEqual(state.directoryFlairs, ['Active', 'Giveaway', 'Roast', 'Vawulence']);
  assert.match(chat.replies[0], /🔥 Active/);
  assert.match(chat.replies[0], /🎁 Giveaway/);
  assert.match(chat.replies[0], /🎤 Roast/);
  assert.match(chat.replies[0], /🌶️ Vawulence/);
});

test('/flair clear removes all labels', async () => {
  state.directoryFlairs = ['Religion'];
  const chat = makeChat();

  await flairCommand.execute({ chat, args: ['clear'] });

  assert.deepEqual(state.directoryFlairs, []);
  assert.match(chat.replies[0], /cleared/i);
});
