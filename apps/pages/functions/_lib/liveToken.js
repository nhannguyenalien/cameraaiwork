const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function liveTokenPayload(siteId, camera, expiresAt, viewerLimit, nonce) {
  return `v2\n${siteId}\n${camera}\n${expiresAt}\n${viewerLimit}\n${nonce}`;
}

export async function signLiveToken(secret, siteId, camera, expiresAt, viewerLimit, nonce) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(liveTokenPayload(siteId, camera, expiresAt, viewerLimit, nonce))
  );
  return `v2.${expiresAt}.${viewerLimit}.${nonce}.${base64Url(new Uint8Array(signature))}`;
}
