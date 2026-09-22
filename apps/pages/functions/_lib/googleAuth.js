// Google OAuth for the customer-managed Google Drive storage backend. One
// platform-owned OAuth client (GOOGLE_OAUTH_CLIENT_ID/SECRET, set as
// Cloudflare Pages env vars) is shared by every account — each account just
// grants it access once via Google Identity Services' popup code flow (see
// functions/api/settings/storage-config/google-exchange.js), and we keep
// only their refresh_token (never a client secret of their own).
// refreshGoogleAccessToken exchanges the stored refresh_token for a fresh
// access token on every Drive call (see objectStorage.js
// googleDriveConfig()), so the connection keeps working indefinitely
// without the customer doing anything again.
//
// Scope is drive.file (not the full drive scope) so Google classifies this
// as a "sensitive" scope, not "restricted" — verification is far lighter
// (no CASA security assessment) at the cost of the app only being able to
// see files/folders the user explicitly grants via the Google Picker
// (see the frontend gdrive-connect flow in public/index.html), never an
// arbitrary pre-existing folder by ID alone.
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function requireOAuthClient(env) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET chưa được cấu hình trên hệ thống");
  }
}

// `code` comes from Google Identity Services' initCodeClient popup flow
// (ux_mode: "popup") — that flow has no real redirect_uri of its own, so
// Google's token endpoint expects the literal value "postmessage" here.
export async function exchangeGoogleAuthCode(env, code) {
  requireOAuthClient(env);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Đổi mã Google OAuth thất bại (${response.status})${data.error_description ? `: ${data.error_description}` : ""}`);
  if (!data.refresh_token) throw new Error("Google không trả về refresh_token. Vào https://myaccount.google.com/permissions thu hồi quyền truy cập cũ của ứng dụng rồi kết nối lại.");
  return data; // { access_token, refresh_token, expires_in, scope, token_type }
}

export async function refreshGoogleAccessToken(env, refreshToken) {
  requireOAuthClient(env);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Làm mới Google access token thất bại (${response.status})${data.error_description ? `: ${data.error_description}` : ""}`);
  return data.access_token;
}
