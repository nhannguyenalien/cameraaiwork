// POST /api/sites  { "name": "Nhà chính" }
// Self-service site registration — used by apps/relay/install.sh so
// onboarding a new site is "run the installer", not "hand-edit Turso".
// go2rtc_url/relay_url start empty; the relay fills them in itself via
// PATCH /api/sites/:id once its Cloudflare Quick Tunnels are up.
import { getDb } from "../../_lib/db.js";
import { json, errorJson, withErrorHandling } from "../../_lib/http.js";
import { randomId, randomSecret } from "../../_lib/ids.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  const name = (body.name || "").trim() || "Site mới";
  const siteId = randomId("st");
  const relaySecret = randomSecret();

  const db = getDb(env);
  await db.execute({
    sql: "INSERT INTO sites (id, account_id, name, go2rtc_url, relay_url, relay_secret) VALUES (?, ?, ?, ?, ?, ?)",
    args: [siteId, data.accountId, name, "", "", relaySecret],
  });

  // relaySecret is only ever returned here — the installer writes it into
  // the relay's local .env and it's never stored anywhere else in plaintext.
  return json({ siteId, relaySecret }, { status: 201 });
});
