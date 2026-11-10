const assert = require('node:assert/strict');
const { test } = require('node:test');

const state = { host: null, path: null, params: null, response: null };

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
  mockModule('../src/utils/rapidapiClient', {
    async rapidGet(host, path, params) {
      state.host = host;
      state.path = path;
      state.params = params;
      return state.response;
    },
    async downloadMediaBuffer() {},
  }),
  mockModule('../src/config', {
    RAPIDAPI_YOUTUBE_HOST: 'yt-api.p.rapidapi.com',
  }),
];

const {
  fetchVideoData,
  pickMuxedVideoFormat,
  extractVideoId,
} = require('../src/utils/ytDownload');

test('YT-API /dl fetches stream data for a single video and selects its muxed MP4', async () => {
  const format = {
    mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
    contentLength: '1048576',
    height: 360,
    url: 'https://media.example/video.mp4',
  };
  state.response = {
    status: 'OK',
    id: 'arj7oStGLkU',
    lengthSeconds: '844',
    formats: [format],
    adaptiveFormats: [],
  };

  const data = await fetchVideoData('https://youtube.com/watch?v=arj7oStGLkU');

  assert.equal(state.host, 'yt-api.p.rapidapi.com');
  assert.equal(state.path, '/dl');
  assert.deepEqual(state.params, { id: 'arj7oStGLkU' });
  assert.equal(data.lengthSeconds, '844');
  assert.equal(pickMuxedVideoFormat(data), format);
  assert.equal(extractVideoId('https://youtu.be/arj7oStGLkU'), 'arj7oStGLkU');
});

test('YT-API errors and responses without stream arrays are rejected', async () => {
  state.response = { status: 'ERROR', formats: [] };
  await assert.rejects(
    fetchVideoData('https://youtube.com/watch?v=arj7oStGLkU'),
    /Video not found/
  );

  state.response = { status: 'OK', title: 'Video without stream data' };
  await assert.rejects(
    fetchVideoData('https://youtube.com/watch?v=arj7oStGLkU'),
    /Video not found/
  );
});

test.after(() => {
  for (const restoreModule of restore.reverse()) restoreModule();
});
