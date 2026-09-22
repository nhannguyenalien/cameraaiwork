// Step 1 of connecting Google Drive: the dashboard runs Google Identity
// Services' popup code flow client-side (scope drive.file), then posts the
// resulting one-time `code` here. We exchange it for tokens and hand back
// only the short-lived access_token (for the Picker the browser is about
// to open) plus an opaque `pending` blob — the refresh_token itself never
// leaves the server. google-finalize.js decrypts `pending` once the user
// has picked a folder and saves the connection.
import { encryptConfig } from "../../../_lib/integrations.js";
import { exchangeGoogleAuthCode } from "../../../_lib/googleAuth.js";
import { errorJson, json, withErrorHandling } from "../../../_lib/http.js";

const PENDING_TTL_MS = 10 * 60 * 1000;

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  const code = body?.code;
  if (!code) return errorJson("Thiếu code từ Google", 400);

  const tokens = await exchangeGoogleAuthCode(env, code);
  const pending = await encryptConfig(env, {
    accountId: data.accountId,
    refreshToken: tokens.refresh_token,
    exp: Date.now() + PENDING_TTL_MS,
  });
  return json({ accessToken: tokens.access_token, pending });
});
