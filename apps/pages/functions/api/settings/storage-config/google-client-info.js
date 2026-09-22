// Public-ish, but authenticated, config the dashboard needs to run the
// client-side Google Identity Services + Picker flow. Neither value is a
// secret in the OAuth sense: an OAuth client_id is meant to be visible to
// the browser (only the client_secret, which never leaves this endpoint,
// is confidential), and the Picker API key is locked to this origin via
// HTTP referrer restriction in Google Cloud Console.
import { errorJson, json, withErrorHandling } from "../../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env }) => {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_PICKER_API_KEY) {
    return errorJson("Google Drive chưa được cấu hình trên hệ thống", 400);
  }
  return json({ clientId: env.GOOGLE_OAUTH_CLIENT_ID, pickerApiKey: env.GOOGLE_PICKER_API_KEY });
});
