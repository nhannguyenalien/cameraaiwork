import { createClient } from "@libsql/client/web";

export function getDb(env) {
  return createClient({
    url: env.TURSO_DB_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
}
