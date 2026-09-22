// Step 2: the dashboard calls this once the user has picked a folder in
// the Google Picker widget. Decrypts the `pending` blob from
// google-exchange.js to recover the refresh_token (it never touched the
// browser), verifies it belongs to the caller's own account, confirms the
// grant can actually read/write the chosen folder, then saves the
// connection.
import { decryptConfig, getIntegration, setIntegration } from "../../../_lib/integrations.js";
import { refreshGoogleAccessToken } from "../../../_lib/googleAuth.js";
import { testGoogleDrive } from "../../../_lib/googleDrive.js";
import { errorJson, json, withErrorHandling } from "../../../_lib/http.js";

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  const folderId = String(body?.folderId || "").trim();
  if (!body?.pending || !folderId) return errorJson("Thiếu pending hoặc folderId", 400);

  let pending;
  try {
    pending = await decryptConfig(env, body.pending);
  } catch {
    return errorJson("Phiên kết nối không hợp lệ hoặc đã hết hạn, hãy thử lại", 400);
  }
  if (pending?.accountId !== data.accountId || Date.now() > Number(pending?.exp)) {
    return errorJson("Phiên kết nối đã hết hạn, hãy thử lại", 400);
  }

  const accessToken = await refreshGoogleAccessToken(env, pending.refreshToken);
  // Verify the grant actually reaches this folder before saving — a stale
  // or revoked Picker selection should fail loudly now, not on the first
  // real motion event.
  await testGoogleDrive({ accessToken, folderId });

  const saved = await getIntegration(env, data.accountId, "storage");
  await setIntegration(env, data.accountId, "storage", {
    backend: "gdrive",
    gdrive: { refreshToken: pending.refreshToken, folderId, connectedAt: new Date().toISOString() },
    ...(saved?.s3 ? { s3: saved.s3 } : {}),
  });
  return json({ ok: true });
});
