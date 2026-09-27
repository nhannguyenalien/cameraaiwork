const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Atomic manifests make interrupted captures recoverable after a restart.
// Media is never kept in memory between capture and upload attempts.
function createEventOutbox({ directory, send, capture, retentionMs = 86400000,
  maxBytes = 2 * 1024 ** 3, maxCaptures = 2, now = Date.now, log = console }) {
  let active = 0, running = false, timer, stopped = true, failures = 0, nextSend = 0, nextPrune = 0;
  const capturing = new Set();
  const ready = fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = (id) => path.join(directory, id, 'event.json');
  async function save(event) {
    const file = manifest(event.id);
    await fs.writeFile(file + '.tmp', JSON.stringify(event), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
  async function entries() {
    await ready;
    const result = [];
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^[a-f0-9-]{36}$/.test(item.name) || capturing.has(item.name)) continue;
      const dir = path.join(directory, item.name);
      try {
        const event = JSON.parse(await fs.readFile(manifest(item.name), 'utf8'));
        if (event.id !== item.name || !Number.isFinite(Date.parse(event.occurredAt))) throw Error('Invalid manifest');
        let bytes = 0;
        for (const name of await fs.readdir(dir)) bytes += (await fs.stat(path.join(dir, name))).size;
        result.push({ event, bytes, dir });
      } catch (error) {
        // A crash before the first manifest is written may leave an empty dir.
        if (now() - (await fs.stat(dir)).mtimeMs > retentionMs) await fs.rm(dir, { recursive: true, force: true });
        else log.warn(`Offline event unreadable: ${item.name}: ${error.message}`);
      }
    }
    return result.sort((a, b) => Date.parse(a.event.occurredAt) - Date.parse(b.event.occurredAt));
  }
  async function prune() {
    const list = await entries();
    let total = list.reduce((sum, item) => sum + item.bytes, 0);
    const keep = [];
    for (const item of list) {
      if (now() - Date.parse(item.event.occurredAt) >= retentionMs || total > maxBytes) {
        await fs.rm(item.dir, { recursive: true, force: true });
        total -= item.bytes;
        log.warn(`Offline event expired/space limit: ${item.event.id}`);
      } else keep.push(item);
    }
    return keep;
  }
  async function enqueue(metadata, frame) {
    await ready;
    const event = { ...metadata, id: randomUUID(), occurredAt: new Date(now()).toISOString() };
    const dir = path.join(directory, event.id);
    capturing.add(event.id);
    try {
      await fs.mkdir(dir, { mode: 0o700 });
      await save(event); // Persist event identity/time before touching camera/media.
      if (frame) {
        await fs.writeFile(path.join(dir, 'image.jpg.tmp'), frame, { mode: 0o600 });
        await fs.rename(path.join(dir, 'image.jpg.tmp'), path.join(dir, 'image.jpg'));
      }
      if (active < maxCaptures) {
        active++;
        try { await capture(event, dir, Boolean(frame)); }
        catch (error) { event.captureError = String(error.message).slice(0, 200); }
        finally { active--; }
      } else event.captureError = 'Local capture concurrency limit';
      await save(event);
      return event.id;
    } finally { capturing.delete(event.id); }
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      if (now() < nextSend && now() < nextPrune) return;
      const list = await prune();
      nextPrune = now() + 60000;
      if (now() < nextSend) return;
      const item = list.filter(({ event }) => !event.retryAfter || event.retryAfter <= now())
        .sort((a, b) => (a.event.retryAfter || 0) - (b.event.retryAfter || 0))[0];
      if (!item) return;
      try {
        const ack = await send(item.event, item.dir);
        if (ack?.ok !== true || ack?.sourceEventId !== item.event.id || ack?.synced !== true) throw Error('Cloud did not acknowledge stored event');
        await fs.rm(item.dir, { recursive: true, force: true });
        failures = 0;
        nextSend = 0;
      } catch (error) {
        failures++;
        // Rotate failed items, so a deleted camera or bad event cannot block others.
        item.event.retryAfter = now() + Math.min(300000, 5000 * 2 ** Math.min(failures - 1, 6));
        await save(item.event);
        nextSend = now() + Math.min(60000, 5000 * 2 ** Math.min(failures - 1, 4));
        log.warn(`Offline sync retry: ${item.event.id}: ${error.message}`);
      }
    } finally { running = false; }
  }
  function start() {
    if (!stopped) return;
    stopped = false;
    const loop = async () => {
      try { await tick(); } catch (error) { log.error('Offline outbox:', error.message); }
      if (!stopped) { timer = setTimeout(loop, 2000); timer.unref?.(); }
    };
    void loop();
  }
  return { enqueue, tick, prune, start, stop() { stopped = true; clearTimeout(timer); } };
}
module.exports = { createEventOutbox };
