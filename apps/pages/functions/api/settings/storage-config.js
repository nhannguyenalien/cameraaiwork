import { effectivePlanForAccount } from "../../_lib/plans.js";
import { storagePolicy } from "../../_lib/storagePolicy.js";
import { getIntegration, setIntegration } from "../../_lib/integrations.js";
import { errorJson, json, withErrorHandling } from "../../_lib/http.js";
import { testS3, validateS3Config } from "../../_lib/s3.js";

function publicConfig(saved = {}) {
  return {
    backend: saved?.backend || "r2", configured: Boolean(saved?.s3 || saved?.gdrive),
    folderId: saved?.gdrive?.folderId, connectedAt: saved?.gdrive?.connectedAt,
    endpoint: saved?.s3?.endpoint, region: saved?.s3?.region, bucket: saved?.s3?.bucket,
    forcePathStyle: saved?.s3?.forcePathStyle,
    accessKeyHint: saved?.s3?.accessKeyId ? `••••${saved.s3.accessKeyId.slice(-4)}` : "",
  };
}

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const saved = await getIntegration(env, data.accountId, "storage");
  const plan = await effectivePlanForAccount(env, data.accountId);
  return json({ ...publicConfig(saved), pool: storagePolicy(saved, plan, Boolean(env.EVENTS_BUCKET)) });
});

// Google Drive is connected via OAuth (google-auth-url.js + google-callback.js
// in this same directory), not through this PUT — there's no raw token for
// the customer to paste anymore. Only r2/s3 are handled here.
export const onRequestPut = withErrorHandling(async ({ request, env, data }) => {
  const body = await request.json().catch(() => null);
  const saved = await getIntegration(env, data.accountId, "storage") || {};
  if (body?.action === "pool") {
    const plan = await effectivePlanForAccount(env, data.accountId);
    if (typeof body.multiStorage !== "boolean") return errorJson("Thiếu chế độ lưu trữ", 400);
    if (body.multiStorage && plan !== "pro") return errorJson("Dùng chung nhiều ổ yêu cầu gói Pro đang hoạt động", 403);
    const available = storagePolicy(saved, plan, Boolean(env.EVENTS_BUCKET)).available;
    if (!Array.isArray(body.order) || body.order.length !== available.length || new Set(body.order).size !== available.length || body.order.some(name => !available.includes(name))) return errorJson("Danh sách ổ không hợp lệ, hãy tải lại trang", 400);
    const updated = { ...saved, multiStorage: body.multiStorage, writeOrder: body.order, backend: body.order[0] || "r2" };
    await setIntegration(env, data.accountId, "storage", updated);
    return json({ ...publicConfig(updated), pool: storagePolicy(updated, plan, Boolean(env.EVENTS_BUCKET)) });
  }
  if (body?.backend === "r2") {
    if (!env.EVENTS_BUCKET) return errorJson("R2 chưa được cấu hình trên hệ thống", 400);
    const retained = { ...saved, ...(saved?.s3 ? { s3: saved.s3 } : {}), ...(saved?.gdrive ? { gdrive: saved.gdrive } : {}) };
    await setIntegration(env, data.accountId, "storage", { ...retained, backend: "r2", writeOrder: ["r2", ...(saved.writeOrder || []).filter(name => name !== "r2")] });
    return json(publicConfig({ ...retained, backend: "r2", writeOrder: ["r2", ...(saved.writeOrder || []).filter(name => name !== "r2")] }));
  }
  if (body?.backend !== "s3") return errorJson("backend phải là r2 hoặc s3 (Google Drive dùng nút Kết nối OAuth)", 400);
  let s3;
  try { s3 = validateS3Config(body); } catch (error) { return errorJson(error.message, 400); }
  try { await testS3(s3); } catch (error) { return errorJson(error.message, 400); }
  await setIntegration(env, data.accountId, "storage", { ...saved, backend: "s3", s3, writeOrder: ["s3", ...(saved.writeOrder || []).filter(name => name !== "s3")] });
  return json(publicConfig({ backend: "s3", s3 }));
});
