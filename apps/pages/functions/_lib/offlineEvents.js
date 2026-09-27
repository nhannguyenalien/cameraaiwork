import { getDb } from './db.js';
import { getSiteUnscoped, getCameraByStreamUnscoped } from './sites.js';
import { effectiveVideoSettingsForAccount, normalizeClipDuration } from './plans.js';
import { resolveStorageChain, putObject } from './objectStorage.js';
import { json, errorJson } from './http.js';
import { getIntegration } from './integrations.js';
import { sendPhotoAlert } from './telegram.js';
import { triggerGpuScan } from './gpuWorker.js';

const MAX_BODY = 24 * 1024 ** 2;
async function authenticate(request, env) {
  const siteId = new URL(request.url).searchParams.get('siteId');
  if (!siteId) return null;
  const site = await getSiteUnscoped(env, siteId);
  return site?.relay_secret && request.headers.get('x-relay-secret') === site.relay_secret ? site : null;
}

export async function offlinePolicy({ request, env }) {
  const site = await authenticate(request, env);
  if (!site) return errorJson('Unauthorized', 401);
  const settings = await effectiveVideoSettingsForAccount(env, site.account_id);
  const result = await getDb(env, 'api.motion.policy').execute({
    sql: 'SELECT stream, record_on_person, clip_duration_seconds FROM cameras WHERE site_id = ? AND account_id = ?',
    args: [site.id, site.account_id],
  });
  const cameras = Object.fromEntries(result.rows.map(camera => [camera.stream, {
    recordOnPerson: Number(camera.record_on_person ?? 1) === 1,
    clipDurationSeconds: normalizeClipDuration(settings.plan, camera.clip_duration_seconds ?? settings.clipDurationSeconds),
  }]));
  return json({ cameras }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function readOfflineForm(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw Object.assign(Error('Event too large'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(Error('Missing body'), { status: 400 });
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw Object.assign(Error('Event too large'), { status: 413 });
    }
    chunks.push(value);
  }
  try {
    const form = await new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('content-type') } }).formData();
    const raw = form.get('metadata');
    if (typeof raw !== 'string' || raw.length > 8192) throw Error('Invalid metadata');
    const event = JSON.parse(raw);
    if (!event || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(event.id) ||
        typeof event.camera !== 'string' || !event.camera || event.camera.length > 200 ||
        typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt)) ||
        Date.parse(event.occurredAt) > Date.now() + 300000 || event.trusted !== true) throw Error('Invalid event');
    const media = {};
    for (const [field, limit] of [['image', 2 * 1024 ** 2], ['video', 20 * 1024 ** 2]]) {
      const file = form.get(field);
      if (!file) continue;
      if (typeof file.arrayBuffer !== 'function' || !file.size || file.size > limit) throw Error('Invalid media size');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (field === 'image' ? bytes[0] !== 255 || bytes[1] !== 216 : String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') throw Error('Invalid media format');
      media[field] = bytes;
    }
    return { event, ...media };
  } catch (error) { throw Object.assign(Error(error.message || 'Invalid offline event'), { status: 400 }); }
}

// Durable identity is claimed before object upload. A retry repairs an unfinished
// row; only the request completing it first may emit a notification.
export async function persistOfflineEvent({ db, site, event, image, video, shouldRecord, chain, put }) {
  const type = event.detection?.hasPerson === false && event.detection?.hasVehicle === true ? 'Vehicle' : 'Person';
  await db.execute({
    sql: `INSERT INTO events (account_id, site_id, camera, timestamp, type, source_event_id, video_status)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (site_id, source_event_id) DO NOTHING`,
    args: [site.account_id, site.id, event.camera, event.occurredAt, type, event.id, shouldRecord ? 'recording' : 'disabled'],
  });
  const found = await db.execute({
    sql: 'SELECT id, camera, timestamp, relay_sync_complete FROM events WHERE site_id = ? AND source_event_id = ? AND account_id = ?',
    args: [site.id, event.id, site.account_id],
  });
  const row = found.rows[0];
  if (!row || row.camera !== event.camera || new Date(row.timestamp).getTime() !== Date.parse(event.occurredAt)) throw Error('Event identity conflict');
  const ack = { ok: true, synced: true, sourceEventId: event.id, eventId: Number(row.id) };
  if (row.relay_sync_complete) return { ack, newlySynced: false };
  const imageKey = image ? `${site.account_id}/${row.id}.jpg` : null;
  const videoKey = shouldRecord && video ? `${site.account_id}/${row.id}.mp4` : null;
  let backend = chain[0] || 'r2', stored = false, lastError;
  for (const candidate of chain) {
    const controller = candidate === 'r2' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
    try {
      if (imageKey) await put(candidate, imageKey, image, 'image/jpeg', controller?.signal);
      if (videoKey) await put(candidate, videoKey, video, 'video/mp4', controller?.signal);
      backend = candidate;
      stored = true;
      break;
    } catch (error) { lastError = error; }
    finally { if (timer) clearTimeout(timer); }
  }
  if (!stored) throw lastError || Error('Storage unavailable');
  const status = !shouldRecord ? 'disabled' : videoKey ? 'ready' : 'error';
  const reason = status === 'error' ? String(event.captureError || 'Local clip unavailable (capture interrupted or recording policy not cached)').slice(0, 300) : null;
  const completed = await db.execute({
    sql: `UPDATE events SET image_key = ?, video_key = ?, storage_backend = ?, video_status = ?, video_error = ?,
          relay_sync_complete = true WHERE id = ? AND relay_sync_complete = false RETURNING id`,
    args: [imageKey, videoKey, backend, status, reason, row.id],
  });
  return { ack, newlySynced: completed.rows.length > 0, backend, type };
}

export async function ingestOfflineEvent({ request, env, waitUntil }) {
  const site = await authenticate(request, env);
  if (!site) return errorJson('Unauthorized', 401);
  const { event, image, video } = await readOfflineForm(request);
  if (event.siteId !== site.id) return errorJson('Site mismatch', 400);
  const camera = await getCameraByStreamUnscoped(env, site.id, event.camera);
  if (!camera || camera.account_id !== site.account_id) return errorJson('Camera not found', 404);
  const db = getDb(env, 'api.motion.offline');
  const result = await persistOfflineEvent({
    db, site, event, image, video,
    shouldRecord: Number(camera.record_on_person ?? 1) === 1,
    chain: await resolveStorageChain(env, site.account_id),
    put: (backend, key, body, type, signal) => putObject(env, site.account_id, backend, key, body, type, signal),
  });
  if (result.newlySynced && image) {
    waitUntil((async () => {
      const delayed = Date.now() - Date.parse(event.occurredAt) > 60000;
      const caption = `${delayed ? '🔄 Đồng bộ sự kiện đã lưu' : '🔔 Phát hiện ' + (result.type === 'Vehicle' ? 'xe' : 'người')} (${site.name || site.id})\n⏰ ${new Date(event.occurredAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;
      const telegram = await getIntegration(env, site.account_id, 'telegram');
      const link = await sendPhotoAlert(telegram, image, caption);
      if (link) await db.execute({ sql: 'UPDATE events SET video_link = ? WHERE id = ?', args: [link, result.ack.eventId] });
    })().catch(error => console.error('Offline event notification:', error.message)));
    if (result.backend === 'r2') waitUntil(triggerGpuScan(env, result.ack.eventId).catch(error => console.error('Offline face scan:', error.message)));
  }
  return json(result.ack);
}
