const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createEventOutbox } = require('../src/event-outbox');
const log = { warn() {}, error() {} };
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'outbox-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, ...options, log, capture: options.capture || (async () => {}) };
}
const ack = event => ({ ok: true, synced: true, sourceEventId: event.id });

test('offline event survives restart and is removed only after exact durable acknowledgement', async t => {
  let time = Date.now();
  const options = await fixture(t, { now: () => time, send: async () => { throw Error('offline'); } });
  const first = createEventOutbox(options);
  const id = await first.enqueue({ camera: 'cam', trusted: true }, Buffer.from('image'));
  await first.tick();
  const manifest = JSON.parse(await fs.readFile(path.join(options.directory, id, 'event.json')));
  assert.equal(manifest.camera, 'cam');
  time += 10000;
  const wrong = createEventOutbox({ ...options, send: async () => ({ ok: true, synced: true, sourceEventId: 'wrong' }) });
  await wrong.tick();
  assert.equal((await wrong.prune()).length, 1);
  time += 10000;
  const restarted = createEventOutbox({ ...options, send: async (event, dir) => {
    assert.equal(event.occurredAt, manifest.occurredAt);
    assert.equal(await fs.readFile(path.join(dir, 'image.jpg'), 'utf8'), 'image');
    return ack(event);
  } });
  await restarted.tick();
  assert.equal((await restarted.prune()).length, 0);
});

test('24 hour expiry and disk cap evict oldest events', async t => {
  let time = Date.now();
  const options = await fixture(t, { now: () => time, send: async () => { throw Error('offline'); } });
  const outbox = createEventOutbox(options);
  const id = await outbox.enqueue({ camera: 'cam' });
  time += 86400000 - 1;
  assert.equal((await outbox.prune()).length, 1);
  time++;
  assert.equal((await outbox.prune()).length, 0);
  const old = await outbox.enqueue({ camera: 'cam' }, Buffer.alloc(1000));
  time++;
  const recent = await outbox.enqueue({ camera: 'cam' }, Buffer.alloc(1000));
  const bounded = createEventOutbox({ ...options, maxBytes: 1300 });
  assert.deepEqual((await bounded.prune()).map(item => item.event.id), [recent]);
  await assert.rejects(fs.stat(path.join(options.directory, old)));
  assert.notEqual(id, recent);
});

test('captures and sends are bounded; in-progress media is not uploaded', async t => {
  let release, active = 0, peak = 0, sends = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const options = await fixture(t, { capture: async () => { active++; peak = Math.max(peak, active); await barrier; active--; }, send: async event => { sends++; return ack(event); } });
  const outbox = createEventOutbox(options);
  const pending = [outbox.enqueue({ camera: 'a' }), outbox.enqueue({ camera: 'b' })];
  while (active < 2) await new Promise(resolve => setTimeout(resolve, 5));
  await outbox.tick();
  assert.equal(sends, 0);
  const overflow = await outbox.enqueue({ camera: 'c' });
  const stored = JSON.parse(await fs.readFile(path.join(options.directory, overflow, 'event.json')));
  assert.match(stored.captureError, /concurrency/);
  release();
  await Promise.all(pending);
  await Promise.all([outbox.tick(), outbox.tick()]);
  assert.equal(sends, 1);
  assert.equal(peak, 2);
});

test('one failing event does not block later events and interrupted captures retain metadata', async t => {
  let time = Date.now();
  const options = await fixture(t, { now: () => time, capture: async () => { throw Error('camera down'); }, send: async event => { if (event.camera === 'bad') throw Error('deleted camera'); return ack(event); } });
  const outbox = createEventOutbox(options);
  await outbox.enqueue({ camera: 'bad' });
  time++;
  await outbox.enqueue({ camera: 'good' });
  await outbox.tick();
  time += 5000;
  await outbox.tick();
  const rows = await outbox.prune();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event.camera, 'bad');
  assert.equal(rows[0].event.captureError, 'camera down');
});
