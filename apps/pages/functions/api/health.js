import { getDb } from "../_lib/db.js";
import { json, withErrorHandling } from "../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env }) => {
  const db = getDb(env);
  await db.execute("SELECT 1"); // proves Neon is reachable, not just that the Function is up
  return json({ ok: true, time: new Date().toISOString() });
});
