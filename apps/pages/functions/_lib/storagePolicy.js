export function storageConnections(saved = {}) {
  return [
    ...["gdrive", "s3"].filter(provider => saved?.[provider]).map(provider => ({ id: provider, provider, name: saved[provider].name || (provider === "gdrive" ? "Google Drive 1" : "S3 1"), config: saved[provider] })),
    ...(saved?.connections || []),
  ];
}

export function storageProvider(id) {
  if (id === "r2") return "r2";
  if (id === "gdrive" || /^gdrive-[a-z0-9-]+$/.test(id)) return "gdrive";
  if (id === "s3" || /^s3-[a-z0-9-]+$/.test(id)) return "s3";
  throw new Error("Kết nối lưu trữ không hợp lệ");
}

export function saveStorageConnection(saved, provider, config, { connectionId, name, plan, newId }) {
  const connections = storageConnections(saved);
  // Older clients update the legacy slot; new clients explicitly send null to add.
  const id = connectionId === undefined ? provider : connectionId;
  const existing = connections.find(item => item.id === id);
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  if (id && !existing && id !== provider) fail("Kết nối không tồn tại, hãy tải lại trang");
  if (existing && existing.provider !== provider) fail("Nhà cung cấp không khớp");
  const sameTarget = (a, b) => provider === "gdrive" ? a.folderId === b.folderId : a.endpoint === b.endpoint && a.bucket === b.bucket && a.region === b.region;
  if (existing && !sameTarget(existing.config, config)) fail("Để giữ dữ liệu cũ, hãy thêm kết nối mới khi đổi thư mục hoặc bucket");
  if (!existing) {
    const siblings = connections.filter(item => item.provider === provider);
    if (siblings.length >= 3) fail("Tối đa 3 kết nối cho mỗi nhà cung cấp");
    if (siblings.length && plan !== "pro") fail("Thêm nhiều tài khoản cùng nhà cung cấp yêu cầu Pro", 403);
    if (siblings.some(item => sameTarget(item.config, config))) fail("Thư mục hoặc bucket này đã được kết nối");
  }
  const target = existing?.id || (!saved[provider] ? provider : newId);
  if (!target) fail("Thiếu mã kết nối");
  const label = String(name || existing?.name || `${provider === "gdrive" ? "Google Drive" : "S3"} ${connections.filter(item => item.provider === provider).length + 1}`).trim().slice(0, 80);
  const updated = { ...saved, backend: target, writeOrder: [target, ...(saved.writeOrder || []).filter(item => item !== target)] };
  if (target === provider) updated[provider] = { ...config, name: label };
  else updated.connections = [...(saved.connections || []).filter(item => item.id !== target), { id: target, provider, name: label, config }];
  return updated;
}

// Connections remain saved after downgrade so historical objects stay readable.
export function storagePolicy(saved = {}, plan = "free", hasR2 = true) {
  const available = storageConnections(saved).map(item => item.id);
  if (hasR2) available.push("r2");
  const preferred = Array.isArray(saved?.writeOrder) ? saved.writeOrder : [saved?.backend, "s3", "gdrive", "r2"];
  const order = [...new Set([...preferred, ...available])].filter(name => available.includes(name));
  const enabled = saved?.multiStorage === true && plan === "pro";
  return { plan, multiStorage: enabled, requestedMultiStorage: saved?.multiStorage === true, order, writeChain: enabled ? order : order.slice(0, 1), available };
}
