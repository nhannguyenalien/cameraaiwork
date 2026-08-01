import { listCameras } from "../../_lib/sites.js";
import { json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  const cameras = await listCameras(env, data.accountId);
  return json(cameras);
});
