const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startOfflineEvents } = require('../src/offline-events');

test('relay caches recording policy and uploads original JPEG/MP4 with authenticated multipart acknowledgement', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offline-integration-'));
  const image = Buffer.from([255,216,255,217]);
  const video = Buffer.from([0,0,0,12,102,116,121,112,0,0,0,0]);
  let received;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers['x-relay-secret'], 'test-secret');
      assert.equal(new URL(req.url, 'http://test').searchParams.get('siteId'), 'site');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') {
        res.end(JSON.stringify({ cameras: { cam: { recordOnPerson: true, clipDurationSeconds: 30 } } }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
      received = JSON.parse(form.get('metadata'));
      assert.deepEqual(Buffer.from(await form.get('image').arrayBuffer()), image);
      assert.deepEqual(Buffer.from(await form.get('video').arrayBuffer()), video);
      res.end(JSON.stringify({ ok: true, synced: true, sourceEventId: received.id }));
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { eventOutboxDir: directory, offlineRetentionHours: 24, offlineMaxBytes: 1024 ** 2,
    offlineUploadBytesPerSecond: 524288, motionWebhookUrl: `http://127.0.0.1:${server.address().port}/api/motion`,
    siteId: 'site', relaySecret: 'test-secret', go2rtc: { url: 'http://unused' } };
  const outbox = startOfflineEvents(config, async (camera, duration, maxBytes) => {
    assert.equal(camera, 'cam'); assert.equal(duration, 30000); assert.equal(maxBytes, 20 * 1024 ** 2);
    return video;
  });
  outbox.stop();
  t.after(async () => { outbox.stop(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fs.stat(path.join(directory, 'policy.json')); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  const cached = JSON.parse(await fs.readFile(path.join(directory, 'policy.json')));
  assert.equal(cached.cam.recordOnPerson, true);
  const id = await outbox.enqueue({ camera: 'cam', trusted: true }, image);
  await outbox.tick();
  assert.equal(received.id, id);
  assert.equal(received.siteId, 'site');
  assert.equal(received.recordVideo, true);
  assert.equal((await outbox.prune()).length, 0);
  // With cloud offline after restart, the previously cached policy still records.
  await new Promise(resolve => server.close(resolve));
  let captured = false;
  const restarted = startOfflineEvents(config, async () => { captured = true; return video; });
  restarted.stop();
  await restarted.enqueue({ camera: 'cam', trusted: true }, image);
  assert.equal(captured, true);
  assert.equal((await restarted.prune()).length, 1);
});
