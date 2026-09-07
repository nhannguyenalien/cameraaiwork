import { storageUsage } from "../../_lib/storageUsage.js";
import { json, withErrorHandling } from "../../_lib/http.js";

export const onRequestGet = withErrorHandling(async ({ env, data }) => {
  return json(await storageUsage(env, data.accountId));
});
