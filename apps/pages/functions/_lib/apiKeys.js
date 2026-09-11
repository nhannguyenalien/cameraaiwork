export const API_KEY_SCOPES = ["full", "read"];

// Session tokens created by login/signup (see _lib/auth.js) reuse this same
// api_keys table with an auto-generated 'web signup'/'web login' label.
// Reserving that prefix keeps user-created keys unambiguous from sessions
// everywhere the two are told apart (list/revoke queries, this check).
const RESERVED_LABEL_PREFIX = /^web /i;

export function validateApiKeyInput({ label, scope, expiresInDays } = {}) {
  const trimmedLabel = typeof label === "string" ? label.trim() : "";
  if (!trimmedLabel || trimmedLabel.length > 100) throw new Error("Tên key phải từ 1 đến 100 ký tự");
  if (RESERVED_LABEL_PREFIX.test(trimmedLabel)) throw new Error('Tên key không được bắt đầu bằng "web " (dành riêng cho phiên đăng nhập)');
  if (!API_KEY_SCOPES.includes(scope)) throw new Error("scope phải là 'full' hoặc 'read'");

  let expiresInDaysNumber = null;
  if (expiresInDays != null) {
    expiresInDaysNumber = Number(expiresInDays);
    if (!Number.isInteger(expiresInDaysNumber) || expiresInDaysNumber < 1 || expiresInDaysNumber > 365) {
      throw new Error("expiresInDays phải từ 1 đến 365");
    }
  }
  return { label: trimmedLabel, scope, expiresInDays: expiresInDaysNumber };
}
