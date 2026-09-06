import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { randomId, randomSecret, sha256Hex } from "../../_lib/ids.js";
import { createSiteTunnel } from "../../_lib/cloudflareTunnel.js";
import { assertCapacity } from "../../_lib/plans.js";

export const onRequestPost = withErrorHandling(async ({ request, env }) => {
  const body = await request.json().catch(() => null);
  const token = String(body?.token || "");
  if (!token.startsWith("install-") || token.length > 200) return errorJson("Mã cài đặt không hợp lệ", 400);
  const siteName = String(body?.siteName || "").trim().slice(0, 120) || "Site mới";
  const cameraName = String(body?.cameraName || "").trim().slice(0, 120) || siteName;
  const stream = String(body?.stream || "cam1").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(stream)) return errorJson("Tên stream không hợp lệ", 400);

  const db = getDb(env);
  const tokenHash = await sha256Hex(token);
  const found = await db.execute({
    sql: "SELECT account_id FROM install_tokens WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')",
    args: [tokenHash],
  });
  const accountId = found.rows[0]?.account_id;
  if (!accountId) return errorJson("Mã cài đặt đã dùng hoặc hết hạn", 401);

  await assertCapacity(env, accountId, "sites");
  await assertCapacity(env, accountId, "cameras");
  const consumed = await db.execute({
    sql: "UPDATE install_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')",
    args: [tokenHash],
  });
  if (Number(consumed.rowsAffected || 0) !== 1) return errorJson("Mã cài đặt đã được sử dụng", 409);

  const siteId = randomId("st");
  const cameraId = randomId("cam");
  const relaySecret = randomSecret();
  try {
    const tunnel = await createSiteTunnel(env, siteId);
    await db.batch([
      {
        sql: "INSERT INTO sites (id, account_id, name, go2rtc_url, relay_url, ai_worker_url, relay_secret, cloudflare_tunnel_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [siteId, accountId, siteName, tunnel.go2rtcUrl, tunnel.relayUrl, tunnel.aiWorkerUrl, relaySecret, tunnel.tunnelId],
      },
      {
        sql: "INSERT INTO cameras (id, site_id, account_id, stream, name) VALUES (?, ?, ?, ?, ?)",
        args: [cameraId, siteId, accountId, stream, cameraName],
      },
    ]);
    return json({ siteId, cameraId, relaySecret, tunnelToken: tunnel.tunnelToken }, { status: 201 });
  } catch (error) {
    await db.execute({
      sql: "UPDATE install_tokens SET used_at = NULL WHERE id = ? AND account_id = ?",
      args: [tokenHash, accountId],
    }).catch(() => {});
    throw error;
  }
});
