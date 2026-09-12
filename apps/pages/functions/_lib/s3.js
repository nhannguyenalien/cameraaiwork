const encoder = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}

async function hmac(key, value, output = "bytes") {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
  return output === "hex" ? hex(signed) : new Uint8Array(signed);
}

function encodePath(value) {
  return value.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

export function validateS3Config(input) {
  const config = {
    endpoint: String(input?.endpoint || "").trim().replace(/\/$/, ""),
    region: String(input?.region || "").trim(),
    bucket: String(input?.bucket || "").trim(),
    accessKeyId: String(input?.accessKeyId || "").trim(),
    secretAccessKey: String(input?.secretAccessKey || ""),
    sessionToken: String(input?.sessionToken || "").trim(),
    forcePathStyle: input?.forcePathStyle !== false,
  };
  let url;
  try { url = new URL(config.endpoint); } catch { throw new Error("S3 endpoint không hợp lệ"); }
  if (url.protocol !== "https:") throw new Error("S3 endpoint phải dùng HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("S3 endpoint không được chứa tài khoản, query hoặc fragment");
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || privateIpv4) throw new Error("S3 endpoint phải là dịch vụ công khai, không được trỏ vào mạng nội bộ");
  if (!config.region || !config.bucket || !config.accessKeyId || !config.secretAccessKey) throw new Error("Region, bucket, access key và secret key là bắt buộc");
  if (!/^[a-zA-Z0-9._-]{1,255}$/.test(config.bucket)) throw new Error("Tên S3 bucket không hợp lệ");
  return config;
}

function objectUrl(config, key = "", query = {}) {
  const base = new URL(config.endpoint);
  const bucket = encodePath(config.bucket);
  if (config.forcePathStyle) base.pathname = `${base.pathname.replace(/\/$/, "")}/${bucket}${key ? `/${encodePath(key)}` : ""}`;
  else {
    base.hostname = `${config.bucket}.${base.hostname}`;
    base.pathname = `${base.pathname.replace(/\/$/, "")}${key ? `/${encodePath(key)}` : "/"}`;
  }
  for (const [name, value] of Object.entries(query)) if (value !== undefined && value !== null) base.searchParams.set(name, String(value));
  return base;
}

export async function s3Request(rawConfig, method, key = "", { body = new Uint8Array(), contentType, range, query } = {}) {
  const config = validateS3Config(rawConfig);
  const url = objectUrl(config, key, query);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payload = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
  const payloadHash = await sha256(payload);
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (config.sessionToken) headers["x-amz-security-token"] = config.sessionToken;
  if (contentType) headers["content-type"] = contentType;
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const canonicalQuery = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedNames.join(";"), payloadHash].join("\n");
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256(canonicalRequest)}`;
  const dateKey = await hmac(`AWS4${config.secretAccessKey}`, date);
  const regionKey = await hmac(dateKey, config.region);
  const serviceKey = await hmac(regionKey, "s3");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${await hmac(signingKey, stringToSign, "hex")}`;
  const fetchHeaders = { ...headers, Authorization: authorization };
  delete fetchHeaders.host;
  if (range) fetchHeaders.Range = range;
  return fetch(url, { method, headers: fetchHeaders, body: method === "PUT" ? payload : undefined });
}

async function ensureOk(response, action) {
  if (response.ok) return response;
  const detail = (await response.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  throw new Error(`${action} S3 thất bại (${response.status})${detail ? `: ${detail}` : ""}`);
}

export async function testS3(config) {
  const key = `.cameraaiwork-connection-test-${crypto.randomUUID()}`;
  await putS3(config, key, new Uint8Array(), "application/octet-stream");
  const head = await headS3(config, key);
  if (!head) throw new Error("Kiểm tra S3 thất bại: không đọc lại được file thử");
  await deleteS3(config, key);
}
export async function putS3(config, key, body, contentType) { await ensureOk(await s3Request(config, "PUT", key, { body, contentType }), "Upload"); }
export async function getS3(config, key, range) { const response = await s3Request(config, "GET", key, { range }); return response.status === 404 ? null : ensureOk(response, "Đọc"); }
export async function headS3(config, key) { const response = await s3Request(config, "HEAD", key); return response.status === 404 ? null : ensureOk(response, "Đọc metadata"); }
export async function deleteS3(config, key) { const response = await s3Request(config, "DELETE", key); if (response.status !== 404) await ensureOk(response, "Xóa"); }
