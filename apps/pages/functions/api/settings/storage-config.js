import { getIntegration, setIntegration } from "../../_lib/integrations.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";
import { testS3, validateS3Config } from "../../_lib/s3.js";

function publicConfig(saved) {
  if (!saved?.s3 && !saved?.gdrive) return { backend: "r2", configured: false };
  if (saved.backend === "gdrive" && saved.gdrive) return {
    backend: "gdrive",
    configured: true,
    folderId: saved.gdrive.folderId,
    connectedAt: saved.gdrive.connectedAt || null,
  };
  if (!saved.s3) return { backend: "r2", configured: false };
  return {
    backend: saved.backend === "s3" ? "s3" : "r2",
    configured: true,
    endpoint: saved.s3.endpoint,
    region: saved.s3.region,
    bucket: saved.s3.bucket,
    forcePathStyle: saved.s3.forcePathStyle,
    accessKeyHint: saved.s3.accessKeyId ? `••••${saved.s3.accessKeyId.slice(-4)}` : "",
    hasSessionToken: Boolean(saved.s3.sessionToken),
  };
}

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  return json(publicConfig(await getIntegration(env, data.accountId, "storage")));
});

// Google Drive is connected via OAuth (google-auth-url.js + google-callback.js
// in this same directory), not through this PUT — there's no raw token for
// the customer to paste anymore. Only r2/s3 are handled here.
export const onRequestPut = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  if (body?.backend === "r2") {
    if (!env.EVENTS_BUCKET) return errorJson("R2 chưa được cấu hình trên hệ thống", 400);
    const saved = await getIntegration(env, data.accountId, "storage");
    const retained = { ...(saved?.s3 ? { s3: saved.s3 } : {}), ...(saved?.gdrive ? { gdrive: saved.gdrive } : {}) };
    await setIntegration(env, data.accountId, "storage", { backend: "r2", ...retained });
    return json(publicConfig({ backend: "r2", ...retained }));
  }
  if (body?.backend !== "s3") return errorJson("backend phải là r2 hoặc s3 (Google Drive dùng nút Kết nối OAuth)", 400);
  let s3;
  try { s3 = validateS3Config(body); } catch (error) { return errorJson(error.message, 400); }
  try { await testS3(s3); } catch (error) { return errorJson(error.message, 400); }
  const saved = await getIntegration(env, data.accountId, "storage");
  await setIntegration(env, data.accountId, "storage", { backend: "s3", s3, ...(saved?.gdrive ? { gdrive: saved.gdrive } : {}) });
  return json(publicConfig({ backend: "s3", s3 }));
});
