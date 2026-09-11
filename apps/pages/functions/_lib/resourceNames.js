export function validateResourceName(value, resourceLabel) {
  const name = String(value || "").trim();
  if (!name || name.length > 120) {
    throw new Error(`Tên ${resourceLabel} phải có từ 1 đến 120 ký tự`);
  }
  return name;
}
