const crypto = require("crypto");
const http = require("http");
const https = require("https");

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function rpcLoginResponse(username, realm, password, random) {
  const ha1 = md5(`${username}:${realm}:${password}`).toUpperCase();
  return md5(`${username}:${random}:${ha1}`).toUpperCase();
}

function parseDigestChallenge(header = "") {
  if (!/^Digest\s/i.test(header)) return null;
  const values = {};
  for (const match of header.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) {
    values[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  return values.realm && values.nonce ? values : null;
}

function digestAuthorization(challenge, username, password, method, uri) {
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const qop = String(challenge.qop || "").split(",").map((v) => v.trim()).find((v) => v === "auth");
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const fields = [
    `username="${username}"`, `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`, `uri="${uri}"`, `response="${response}"`,
  ];
  if (challenge.opaque) fields.push(`opaque="${challenge.opaque}"`);
  if (challenge.algorithm) fields.push(`algorithm=${challenge.algorithm}`);
  if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${fields.join(", ")}`;
}

function requestOnce(camera, path, authorization) {
  const secure = camera.onvif?.protocol === "https";
  const transport = secure ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: camera.onvif.ip,
      port: camera.onvif.port || (secure ? 443 : 80),
      path,
      method: "GET",
      headers: authorization ? { Authorization: authorization } : {},
      timeout: 4000,
      rejectUnauthorized: false,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (body.length < 256000) body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("timeout", () => req.destroy(new Error("Dahua CGI timeout")));
    req.on("error", reject);
    req.end();
  });
}

function postJson(camera, path, payload) {
  const secure = camera.onvif?.protocol === "https";
  const transport = secure ? https : http;
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: camera.onvif.ip,
      port: camera.onvif.port || (secure ? 443 : 80),
      path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 4000,
      rejectUnauthorized: false,
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (responseBody.length < 256000) responseBody += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Dahua RPC timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

async function rpcLogin(camera) {
  const username = camera.onvif.username;
  const first = await postJson(camera, "/RPC2_Login", {
    method: "global.login", params: { userName: username, password: "", clientType: "Web3.0" }, id: 10000,
  });
  const challenge = first.json?.params;
  const session = first.json?.session;
  if (!session || !challenge?.realm || !challenge?.random) return null;
  const password = rpcLoginResponse(username, challenge.realm, camera.onvif.password, challenge.random);
  const second = await postJson(camera, "/RPC2_Login", {
    method: "global.login", session,
    params: {
      userName: username, password, clientType: "Web3.0",
      authorityType: challenge.authorityType || "Default", passwordType: "Default",
    },
    id: 10000,
  });
  // Some Dahua firmware rotates the session id after successful authentication.
  return second.json?.result === true ? (second.json.session || session) : null;
}

async function rpcCall(camera, session, method, params = null) {
  const response = await postJson(camera, "/RPC2", { method, params, session, id: 1 });
  return response.status === 200 ? response.json : null;
}

async function withRpc(camera, callback) {
  const session = await rpcLogin(camera);
  if (!session) return null;
  try { return await callback((method, params) => rpcCall(camera, session, method, params)); }
  finally { rpcCall(camera, session, "global.logout").catch(() => {}); }
}

async function request(camera, path) {
  const first = await requestOnce(camera, path);
  if (first.status !== 401) return first;
  const challenge = parseDigestChallenge(first.headers["www-authenticate"]);
  if (!challenge) return first;
  const auth = digestAuthorization(challenge, camera.onvif.username, camera.onvif.password, "GET", path);
  return requestOnce(camera, path, auth);
}

function parseWhiteLightKeys(body) {
  return [...String(body || "").matchAll(/^table\.(Lighting_V2\[[^\r\n=]+\])\.LightType=WhiteLight\s*$/gm)]
    .map((match) => match[1]);
}

async function probeLight(camera) {
  let rpc = false;
  try {
    const status = await withRpc(camera, (call) => call("CoaxialControlIO.getStatus"));
    if (status?.result === true && status?.params?.status && "WhiteLight" in status.params.status) {
      rpc = true;
    }
  } catch {}
  try {
    const path = "/cgi-bin/configManager.cgi?action=getConfig&name=Lighting_V2";
    const response = await request(camera, path);
    if (response.status !== 200 || !/LightType=WhiteLight\s*$/m.test(response.body)) return rpc ? { backend: "dahua-rpc2" } : null;
    const whiteLightKeys = parseWhiteLightKeys(response.body);
    return whiteLightKeys.length
      ? { backend: rpc ? "dahua-rpc2" : "dahua-cgi", whiteLightKey: whiteLightKeys[0], whiteLightKeys }
      : (rpc ? { backend: "dahua-rpc2" } : null);
  } catch {
    return rpc ? { backend: "dahua-rpc2" } : null;
  }
}

function parseLightState(response) {
  const value = response?.params?.status?.WhiteLight;
  if (value === "On") return true;
  if (value === "Off") return false;
  return null;
}

async function waitForLightState(call, expected, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  do {
    // The CGI/RPC call is acknowledged before the lamp driver has applied the
    // new state on several Dahua models. Reading immediately reports the old
    // value and used to make a successful click look like a 409 failure.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const status = await call("CoaxialControlIO.getStatus");
    const actual = status?.result === true ? parseLightState(status) : null;
    if (actual === expected) return true;
  } while (Date.now() < deadline);
  return false;
}

async function getLightState(camera, capability) {
  if (capability?.backend !== "dahua-rpc2") return null;
  try {
    const status = await withRpc(camera, (call) => call("CoaxialControlIO.getStatus"));
    return status?.result === true ? parseLightState(status) : null;
  } catch {
    return null;
  }
}

async function setLight(camera, capability, enabled) {
  // Lighting_V2 changes the operating mode as well as the output level. This
  // matters after Auto mode: several Dahua firmwares reject a raw RPC output
  // command until the light has first been returned to Manual/Off mode.
  let cgiChanged = false;
  if (capability?.whiteLightKey) {
    // Lighting_V2 commonly contains separate Normal/Day/Night profiles. The
    // active profile is firmware-controlled, so changing only the first key
    // can return OK without changing the physical lamp. Apply the requested
    // state to every WhiteLight profile exposed by this camera.
    const bases = capability.whiteLightKeys?.length ? capability.whiteLightKeys : [capability.whiteLightKey];
    const params = bases.flatMap((base) => enabled
      ? [[`${base}.Mode`, "Manual"], [`${base}.NearLight[0].Light`, "100"]]
      : [[`${base}.Mode`, "Off"]]);
    const query = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    try {
      const response = await request(camera, `/cgi-bin/configManager.cgi?action=setConfig&${query}`);
      cgiChanged = response.status === 200 && /^OK\s*$/m.test(response.body);
    } catch {}
  }
  if (capability?.backend === "dahua-rpc2") {
    try {
      if (cgiChanged) await new Promise((resolve) => setTimeout(resolve, 400));
      return Boolean(await withRpc(camera, async (call) => {
        const changed = await call("CoaxialControlIO.control", {
          info: [{ Type: 1, IO: enabled ? 1 : 2, TriggerMode: 2 }],
        });
        if (changed?.result !== true) {
          console.warn(`Dahua white-light command rejected (${camera.id || camera.onvif?.ip}): ${JSON.stringify(changed)}`);
          return false;
        }
        const verified = await waitForLightState(call, enabled);
        if (!verified) console.warn(`Dahua white-light state mismatch (${camera.id || camera.onvif?.ip}): expected=${enabled}`);
        return verified;
      }));
    } catch (error) {
      console.warn(`Dahua white-light RPC failed (${camera.id || camera.onvif?.ip}): ${error.message}`);
      return false;
    }
  }
  return cgiChanged;
}

async function setLightMode(camera, capability, mode) {
  if (mode === "on" || mode === "off") return setLight(camera, capability, mode === "on");
  if (mode !== "auto" || !capability?.whiteLightKey) return false;
  const bases = capability.whiteLightKeys?.length ? capability.whiteLightKeys : [capability.whiteLightKey];
  const query = bases.map((base) => `${encodeURIComponent(`${base}.Mode`)}=Auto`).join("&");
  try {
    const response = await request(camera, `/cgi-bin/configManager.cgi?action=setConfig&${query}`);
    return response.status === 200 && /^OK\s*$/m.test(response.body);
  } catch { return false; }
}

async function alarmCapability(camera) {
  try {
    const values = await getIoStatus(camera);
    return Boolean(values && Object.keys(values).some((key) => /speaker|siren|alarm|audio/i.test(key)));
  } catch { return false; }
}

async function getIoStatus(camera) {
  try {
    const response = await withRpc(camera, (call) => call("CoaxialControlIO.getStatus"));
    return response?.result === true && response?.params?.status ? response.params.status : null;
  } catch { return null; }
}

async function setAlarm(camera, enabled) {
  try {
    return Boolean(await withRpc(camera, async (call) => {
      const result = await call("CoaxialControlIO.control", { info: [{ Type: 2, IO: enabled ? 1 : 2, TriggerMode: 2 }] });
      return result?.result === true;
    }));
  } catch { return false; }
}

async function getAlarmState(camera) {
  const status = await getIoStatus(camera);
  if (status?.Speaker === "On") return true;
  if (status?.Speaker === "Off") return false;
  return null;
}

module.exports = { parseDigestChallenge, digestAuthorization, rpcLoginResponse, parseWhiteLightKeys, parseLightState, probeLight, getLightState, setLight, setLightMode, getIoStatus, alarmCapability, getAlarmState, setAlarm };
