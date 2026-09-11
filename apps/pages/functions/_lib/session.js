export const WEB_SESSION_SECONDS = 12 * 60 * 60;

export function readSessionToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)cameraai_session=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return bearer && bearer !== "null" && bearer !== "undefined" ? bearer : "";
}

export function sessionCookie(token) {
  return `cameraai_session=${encodeURIComponent(token)}; Max-Age=${WEB_SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return "cameraai_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict";
}

export function isWebClient(request) {
  return request.headers.get("X-CameraAI-Client") === "web";
}
