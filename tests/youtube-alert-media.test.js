const assert = require('node:assert/strict');
const { test } = require('node:test');

const state = {
  duration: '60',
  contentLength: String(1024 * 1024),
  downloads: 0,
};

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
  mockModule('../src/models/YoutubeWatch', { find: async () => [] }),
  mockModule('../src/utils/youtubeRss', { fetchLatestVideos: async () => [] }),
  mockModule('../src/utils/ytDownload', {
    async fetchVideoData() {
      return {
        lengthSeconds: state.duration,
        formats: [{
          mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
          contentLength: state.contentLength,
          url: 'https://media.example/video.mp4',
        }],
      };
    },
    pickMuxedVideoFormat(item) {
      return item.formats[0] || null;
    },
    async downloadMediaBuffer(_url, options) {
      state.downloads++;
      assert.equal(options.maxBytes, 90 * 1024 * 1024);
      return Buffer.from('mp4');
    },
  }),
  mockModule('../src/config', {
    YOUTUBE_ALERT_CHECK_INTERVAL_MS: 300_000,
    RAPIDAPI_KEY: 'test-key',
    YT_MAX_DURATION_MINUTES: 15,
    YT_MAX_FILE_SIZE_MB: 90,
  }),
];

const { sendYoutubeAlert } = require('../src/utils/youtubeAlertScheduler');

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for YouTube alert media task');
}

test('authorized channel alerts send the RSS message and then attach an eligible MP4', async () => {
  state.duration = '60';
  state.contentLength = String(1024 * 1024);
  state.downloads = 0;
  const sent = [];
  const watch = { groupId: 'youtube-media@g.us', channelTitle: 'My Channel', includeVideo: true };
  const video = { videoId: 'video-123', title: 'New upload', url: 'https://youtube.com/watch?v=video-123' };
  const sock = { async sendMessage(...args) { sent.push(args); } };

  await sendYoutubeAlert(sock, watch, video);
  assert.match(sent[0][1].text, /New upload/);
  await waitFor(() => sent.some(([, payload]) => !!payload.video));
  assert.equal(sent[1][1].mimetype, 'video/mp4');
  assert.equal(sent[1][1].fileName, 'New upload.mp4');
  assert.equal(state.downloads, 1);
});

test('channels without explicit video permission receive RSS alerts only', async () => {
  state.downloads = 0;
  const sent = [];
  await sendYoutubeAlert(
    { async sendMessage(...args) { sent.push(args); } },
    { groupId: 'youtube-links@g.us', channelTitle: 'Other Channel', includeVideo: false },
    { videoId: 'video-456', title: 'Another upload', url: 'https://youtube.com/watch?v=video-456' }
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
  assert.equal(state.downloads, 0);
});

test('Group Status destination relays YouTube alerts inside the watched group', async () => {
  const sent = [];
  const sock = {
    user: { id: 'bot@s.whatsapp.net' },
    async relayMessage(...args) { sent.push(args); },
  };

  await sendYoutubeAlert(
    sock,
    { groupId: 'youtube-status@g.us', channelTitle: 'My Channel', destination: 'groupStatus', includeVideo: false },
    { videoId: 'video-status', title: 'Status upload', url: 'https://youtube.com/watch?v=video-status' }
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'youtube-status@g.us');
  const decoded = require('@whiskeysockets/baileys').proto.Message.decode(
    require('@whiskeysockets/baileys').proto.Message.encode(sent[0][1]).finish()
  );
  assert.match(decoded.groupStatusMessage.message.extendedTextMessage.text, /Status upload/);
  assert.deepEqual(sent[0][2].additionalNodes, [{
    tag: 'meta',
    attrs: { is_group_status: 'true', origin: 'group_status' },
  }]);
});

test('videos beyond the duration limit remain link-only', async () => {
  state.duration = '901';
  state.downloads = 0;
  const sent = [];
  await sendYoutubeAlert(
    { async sendMessage(...args) { sent.push(args); } },
    { groupId: 'youtube-too-long@g.us', channelTitle: 'My Channel', includeVideo: true },
    { videoId: 'video-789', title: 'Long upload', url: 'https://youtube.com/watch?v=video-789' }
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
  assert.equal(state.downloads, 0);
});

test('videos beyond the file-size limit remain link-only', async () => {
  state.duration = '60';
  state.contentLength = String(91 * 1024 * 1024);
  state.downloads = 0;
  const sent = [];
  await sendYoutubeAlert(
    { async sendMessage(...args) { sent.push(args); } },
    { groupId: 'youtube-too-large@g.us', channelTitle: 'My Channel', includeVideo: true },
    { videoId: 'video-large', title: 'Large upload', url: 'https://youtube.com/watch?v=video-large' }
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
  assert.equal(state.downloads, 0);
});

test.after(() => {
  for (const restoreModule of restore.reverse()) restoreModule();
});
