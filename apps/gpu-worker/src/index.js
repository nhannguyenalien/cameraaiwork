import { neon } from "@neondatabase/serverless";

const GPU_URL = "https://vision-api.schoolsai.work/v1/faces/embed";

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
}

function randomId() {
  return `person-${crypto.randomUUID().replaceAll("-", "")}`;
}

async function acquireLease(sql) {
  await sql`INSERT INTO gpu_worker_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
  const rows = await sql`UPDATE gpu_worker_state
    SET locked_until = CURRENT_TIMESTAMP + INTERVAL '4 minutes', updated_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND locked_until <= CURRENT_TIMESTAMP RETURNING id`;
  return rows.length > 0;
}

async function findOrCreate(sql, accountId, embedding, threshold) {
  const people = await sql`SELECT id, embedding FROM gpu_people WHERE account_id = ${accountId}`;
  let bestId = null, bestScore = -1;
  for (const row of people) {
    let known;
    try { known = JSON.parse(row.embedding); } catch { continue; }
    if (!Array.isArray(known) || known.length !== embedding.length) continue;
    const score = cosine(known, embedding);
    if (score > bestScore) { bestScore = score; bestId = row.id; }
  }
  if (bestId && bestScore >= threshold) return bestId;
  const id = randomId();
  await sql`INSERT INTO gpu_people (id, account_id, embedding) VALUES (${id}, ${accountId}, ${JSON.stringify(embedding)})`;
  return id;
}

async function scanEvent(env, sql, event, threshold) {
  try {
    const object = await env.EVENTS_BUCKET.get(event.image_key);
    if (!object) throw new Error("R2 image not found");
    const form = new FormData();
    form.append("file", new Blob([await object.arrayBuffer()], { type: object.httpMetadata?.contentType || "image/jpeg" }), "event.jpg");
    const response = await fetch(GPU_URL, {
      method: "POST", headers: { Authorization: `Bearer ${env.VISION_API_TOKEN}` }, body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || payload.error || `GPU HTTP ${response.status}`);

    for (const face of (payload.faces || []).slice(0, 20)) {
      const embedding = face.embedding;
      if (!Array.isArray(embedding) || !embedding.length || embedding.some((n) => !Number.isFinite(n))) continue;
      const personId = await findOrCreate(sql, event.account_id, embedding, threshold);
      const box = Array.isArray(face.bbox_xyxy) ? JSON.stringify(face.bbox_xyxy) : null;
      await sql`INSERT INTO event_gpu_people (event_id, person_id, face_box)
        VALUES (${event.id}, ${personId}, ${box})
        ON CONFLICT (event_id, person_id) DO UPDATE SET face_box = COALESCE(event_gpu_people.face_box, EXCLUDED.face_box)`;
      await sql`UPDATE gpu_people SET
        seen_count = (SELECT COUNT(*) FROM event_gpu_people WHERE person_id = ${personId}),
        first_seen_at = COALESCE((SELECT MIN(e.timestamp) FROM event_gpu_people ep JOIN events e ON e.id=ep.event_id WHERE ep.person_id=${personId}), first_seen_at),
        last_seen_at = COALESCE((SELECT MAX(e.timestamp) FROM event_gpu_people ep JOIN events e ON e.id=ep.event_id WHERE ep.person_id=${personId}), last_seen_at)
        WHERE id = ${personId}`;
    }
    await sql`UPDATE events SET gpu_face_scan_status='completed', gpu_face_scanned_at=CURRENT_TIMESTAMP,
      gpu_face_scan_error=NULL WHERE id=${event.id}`;
  } catch (error) {
    await sql`UPDATE events SET gpu_face_scan_status = CASE WHEN gpu_face_scan_attempts >= ${Number(env.GPU_MAX_ATTEMPTS || 3)} THEN 'failed' ELSE 'pending' END,
      gpu_face_scan_error=${String(error.message || error).slice(0, 500)} WHERE id=${event.id}`;
  }
}

async function run(env, requestedEventId = null) {
  if (!env.DATABASE_URL || !env.VISION_API_TOKEN || !env.EVENTS_BUCKET) throw new Error("Missing worker binding/secret");
  const sql = neon(env.DATABASE_URL);
  if (!await acquireLease(sql)) return;
  try {
    const limit = Math.max(1, Math.min(5, Number(env.GPU_MAX_EVENTS_PER_RUN || 1)));
    const maxAttempts = Math.max(1, Number(env.GPU_MAX_ATTEMPTS || 3));
    const events = await sql`WITH candidates AS (
      SELECT e.id FROM events e JOIN accounts a ON a.id=e.account_id
      WHERE a.gpu_face_enabled=1 AND e.image_key IS NOT NULL
        AND (${requestedEventId}::bigint IS NULL OR e.id=${requestedEventId})
        AND COALESCE(e.gpu_face_scan_status, 'pending') IN ('pending','error')
        AND COALESCE(e.gpu_face_scan_attempts, 0) < ${maxAttempts}
      ORDER BY e.timestamp DESC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) UPDATE events e SET gpu_face_scan_status='processing', gpu_face_scan_started_at=CURRENT_TIMESTAMP,
      gpu_face_scan_attempts=COALESCE(gpu_face_scan_attempts,0)+1, gpu_face_scan_error=NULL
      FROM candidates c WHERE e.id=c.id RETURNING e.id,e.account_id,e.image_key`;
    const threshold = Number(env.GPU_SIMILARITY_THRESHOLD || 0.30);
    for (const event of events) await scanEvent(env, sql, event, threshold);
  } finally {
    await sql`UPDATE gpu_worker_state SET locked_until=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=1`;
  }
}

export default {
  scheduled(_controller, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.INTERNAL_TOKEN || bearer !== env.INTERNAL_TOKEN) return new Response("Unauthorized", { status: 401 });
    const body = await request.json().catch(() => ({}));
    const parsed = Number(body.eventId);
    const eventId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    ctx.waitUntil(run(env, eventId));
    return Response.json({ accepted: true });
  },
};

export { cosine, run };
