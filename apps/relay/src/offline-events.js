const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const { createEventOutbox } = require('./event-outbox');

async function writeMedia(dir, name, bytes) {
  const file = path.join(dir, name);
  await fs.writeFile(file + '.tmp', bytes, { mode: 0o600 });
  await fs.rename(file + '.tmp', file);
}

function startOfflineEvents(config, captureClip) {
  let policies = {}, refreshing = false;
  const policyFile = path.join(config.eventOutboxDir, 'policy.json');
  const loaded = fs.readFile(policyFile, 'utf8').then(raw => { policies = JSON.parse(raw); }).catch(() => {});
  async function refresh() {
    if (refreshing || !config.motionWebhookUrl) return;
    refreshing = true;
    try {
      await loaded;
      const response = await axios.get(config.motionWebhookUrl, {
        params: { siteId: config.siteId }, headers: { 'x-relay-secret': config.relaySecret }, timeout: 10000,
      });
      if (!response.data?.cameras) throw Error('Missing offline camera policy');
      const next = response.data.cameras;
      await fs.mkdir(config.eventOutboxDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(policyFile + '.tmp', JSON.stringify(next), { mode: 0o600 });
      await fs.rename(policyFile + '.tmp', policyFile);
      policies = next;
    } catch (error) { console.warn('Offline recording policy: using cached settings:', error.message); }
    finally { refreshing = false; }
  }
  const outbox = createEventOutbox({
    directory: config.eventOutboxDir,
    retentionMs: config.offlineRetentionHours * 3600000,
    maxBytes: config.offlineMaxBytes,
    async capture(event, dir, hasFrame) {
      await loaded;
      const policy = policies[event.camera];
      // Unknown settings fail closed for video until one successful policy sync.
      event.recordVideo = policy?.recordOnPerson === true;
      const seconds = [10, 30, 60].includes(policy?.clipDurationSeconds) ? policy.clipDurationSeconds : 10;
      // Start recording at detection time, independently of the snapshot request.
      const results = await Promise.allSettled([
        hasFrame ? Promise.resolve() : axios.get(`${config.go2rtc.url}/api/frame.jpeg`, {
          params: { src: event.camera }, responseType: 'arraybuffer', timeout: 10000, maxContentLength: 2 * 1024 ** 2,
        }).then(async ({ data }) => {
          const jpeg = Buffer.from(data);
          if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw Error('Invalid JPEG');
          await writeMedia(dir, 'image.jpg', jpeg);
        }),
        event.recordVideo ? captureClip(event.camera, seconds * 1000, 20 * 1024 ** 2)
          .then(clip => writeMedia(dir, 'video.mp4', clip)) : Promise.resolve(),
      ]);
      const errors = results.filter(r => r.status === 'rejected');
      if (errors.length) event.captureError = errors.map(r => r.reason?.message || 'Capture failed').join('; ').slice(0, 200);
    },
    async send(event, dir) {
      if (!config.motionWebhookUrl) throw Error('MOTION_WEBHOOK_URL is not configured');
      const form = new FormData();
      form.append('metadata', JSON.stringify({ ...event, siteId: config.siteId }));
      for (const [field, name, type] of [['image', 'image.jpg', 'image/jpeg'], ['video', 'video.mp4', 'video/mp4']]) {
        try { form.append(field, new Blob([await fs.readFile(path.join(dir, name))], { type }), name); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const { data } = await axios.post(config.motionWebhookUrl, form, {
        params: { siteId: config.siteId },
        headers: { 'x-relay-secret': config.relaySecret }, timeout: 180000,
        maxBodyLength: 24 * 1024 ** 2,
        // One upload at a time, capped at 512 KiB/s to leave bandwidth for live view.
        maxRate: [config.offlineUploadBytesPerSecond, 0],
      });
      return data;
    },
  });
  void refresh();
  const timer = setInterval(refresh, 60000);
  timer.unref();
  outbox.start();
  const stop = outbox.stop;
  outbox.stop = () => { clearInterval(timer); stop(); };
  return outbox;
}
module.exports = { startOfflineEvents };
