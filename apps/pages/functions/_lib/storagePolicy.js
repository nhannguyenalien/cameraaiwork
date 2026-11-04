// Connections remain saved after downgrade so historical objects stay readable.
export function storagePolicy(saved = {}, plan = "free", hasR2 = true) {
  const available = ["gdrive", "s3"].filter(name => saved?.[name]);
  if (hasR2) available.push("r2");
  const preferred = Array.isArray(saved?.writeOrder) ? saved.writeOrder : [saved?.backend, "s3", "gdrive", "r2"];
  const order = [...new Set([...preferred, ...available])].filter(name => available.includes(name));
  const enabled = saved?.multiStorage === true && plan === "pro";
  return { plan, multiStorage: enabled, requestedMultiStorage: saved?.multiStorage === true, order, writeChain: enabled ? order : order.slice(0, 1), available };
}
