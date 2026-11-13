import { getIntegration } from "../../_lib/integrations.js";
import { storageConnections, storageProvider } from "../../_lib/storagePolicy.js";
import { reconcileDrive } from "../../_lib/storageReconcile.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";

async function run(env, accountId, backend, apply) {
  if (!backend || storageProvider(backend) !== "gdrive") return errorJson("backend phải là một kết nối Google Drive", 400);
  const saved = await getIntegration(env, accountId, "storage");
  if (!storageConnections(saved).some((item) => item.id === backend)) return errorJson("Kết nối không tồn tại", 404);
  return json(await reconcileDrive(env, accountId, backend, { apply }));
}

// GET = read-only report. POST {backend, apply:true} = delete orphan files and fix DB references.
export const onRequestGet = withErrorHandling(async ({ request, env, data }) =>
  run(env, data.accountId, new URL(request.url).searchParams.get("backend"), false));

export const onRequestPost = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => ({}));
  return run(env, data.accountId, body.backend, body.apply === true);
});
