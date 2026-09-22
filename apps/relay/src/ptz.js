const { Cam } = require("onvif");
const { URL } = require("url");
const config = require("./config");
const dahua = require("./dahua");

const connections = new Map(); // camera id -> Cam instance
// camera id -> { audioOutput: boolean, relayOutputs: string[], deviceIOUrl: object }
// DeviceIO relay outputs need a low-level request; media audio outputs are
// available through the package helper. Both are cached per connection.
const extras = new Map();
const patrols = new Map();
const blinkers = new Map();
const lightModeStates = new Map();
// Dahua reports CoaxialControlIO state a little after accepting a light command.
// Keep the state that setLight() already verified briefly so an immediate UI
// refresh cannot overwrite the correct switch value with the previous state.
const lightStateHints = new Map();

function rememberLightState(cameraId, enabled) {
  lightStateHints.set(cameraId, { enabled, expiresAt: Date.now() + 3000 });
}

function cancelBlink(cameraId) {
  const state = blinkers.get(cameraId);
  if (!state) return null;
  state.cancelled = true;
  if (state.timer) clearTimeout(state.timer);
  blinkers.delete(cameraId);
  return state.pending || null;
}

// onReady(cameraId, camInstance) fires once ONVIF is connected — index.js
// uses it to attach the motion event listener to this same connection
// (see the note in index.js about why motion comes from ONVIF, not go2rtc).
function connectAll(onReady) {
  for (const camera of config.cameras) {
    if (camera.hasOnvif === false) continue;
    connectOne(camera, onReady);
  }
}

function connectOne(camera, onReady) {
  // No ONVIF service on this camera at all (cheap/legacy, RTSP-only) — don't
  // attempt a connection that would just retry forever. index.js starts the
  // snapshot+AI polling fallback for these directly instead.
  if (camera.hasOnvif === false) return;
  new Cam(
    {
      hostname: camera.onvif.ip,
      username: camera.onvif.username,
      password: camera.onvif.password,
      port: camera.onvif.port,
    },
    function (err) {
      if (err) {
        console.error(`❌ ONVIF PTZ lỗi (${camera.id}):`, err.message);
        setTimeout(() => connectOne(camera, onReady), 5000);
        return;
      }
      connections.set(camera.id, this);
      console.log(`✅ ONVIF PTZ sẵn sàng: ${camera.id}`);
      probeExtras(this, camera);
      onReady?.(camera.id, this);
    }
  );
}

function xaddrToRequestUrl(xaddr, cam) {
  try {
    const parsed = new URL(xaddr);
    return { hostname: parsed.hostname, port: parsed.port || 80, path: parsed.pathname, agent: cam.agent, timeout: cam.timeout };
  } catch {
    return null;
  }
}

function call(cam, method, options) {
  return new Promise((resolve) => {
    if (typeof cam?.[method] !== "function") return resolve(null);
    const callback = (err, value) => resolve(err ? null : value);
    try {
      if (options === undefined) cam[method](callback);
      else cam[method](options, callback);
    } catch {
      resolve(null);
    }
  });
}

function plain(value, depth = 0) {
  if (depth > 8 || value == null) return value == null ? null : "[truncated]";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => plain(item, depth + 1));
  if (typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|credential|authorization/i.test(key) || typeof item === "function") continue;
    if (/xaddr|uri|url/i.test(key) && typeof item === "string") {
      try {
        const parsed = new URL(item);
        parsed.username = "";
        parsed.password = "";
        result[key] = parsed.toString();
      } catch { result[key] = item; }
    } else result[key] = plain(item, depth + 1);
  }
  return result;
}

// Audio-output (speaker) and DeviceIO relay-output (siren/alarm relay)
// support vary per model and aren't exposed by the onvif package's helper
// methods, so they're queried once via GetAudioOutputs / GetCapabilities +
// GetRelayOutputs and cached for capabilities()/setAlarm() to use.
function probeExtras(cam, camera) {
  const cameraId = camera.id;
  cam.getAudioOutputs((err, outputs) => {
    const audioOutput = !err && Array.isArray(outputs) && outputs.length > 0;
    extras.set(cameraId, { ...extras.get(cameraId), audioOutput });
  });
  cam.getCapabilities((err, caps) => {
    const xaddr = caps?.extension?.deviceIO?.XAddr || caps?.extension?.deviceIO?.xAddr;
    if (err || !xaddr) return;
    const url = xaddrToRequestUrl(xaddr, cam);
    if (!url) return;
    cam._request({
      url,
      body: cam._envelopeHeader() + '<GetRelayOutputs xmlns="http://www.onvif.org/ver10/deviceIO/wsdl"/>' + cam._envelopeFooter(),
    }, (err2, data) => {
      if (err2) return;
      try {
        const response = data?.[0]?.getRelayOutputsResponse?.[0] || {};
        // node-onvif lowercases the first character of regular XML tag names.
        // Keep the capitalized fallback for cameras/parsers that preserve it.
        const outputs = response.relayOutputs || response.RelayOutputs || [];
        const tokens = outputs.map((item) => item?.["$"]?.token).filter(Boolean);
        extras.set(cameraId, { ...extras.get(cameraId), relayOutputs: tokens, deviceIOUrl: url });
      } catch {}
    });
  });
  const sameIpCount = config.cameras.filter((item) => item.onvif?.ip === camera.onvif?.ip).length;
  if (camera.dahuaCgiLight !== false && (camera.dahuaCgiLight === true || sameIpCount === 1)) {
    dahua.probeLight(camera).then((dahuaLight) => {
      if (dahuaLight) extras.set(cameraId, { ...extras.get(cameraId), camera, dahuaLight });
    });
    dahua.alarmCapability(camera).then((dahuaAlarm) => {
      if (dahuaAlarm) extras.set(cameraId, { ...extras.get(cameraId), camera, dahuaAlarm });
    });
  }
}

async function inventory(cameraId, refresh = false) {
  const cam = connections.get(cameraId);
  if (!cam) return null;
  if (refresh) {
    const camera = config.cameras.find((item) => item.id === cameraId);
    if (camera) probeExtras(cam, camera);
  }
  const [deviceInformation, audioSources, audioOutputs, imaging, presets] = await Promise.all([
    call(cam, "getDeviceInformation"),
    call(cam, "getAudioSources"),
    call(cam, "getAudioOutputs"),
    call(cam, "getImagingSettings"),
    cam.activeSource?.ptz ? call(cam, "getPresets", {}) : Promise.resolve(null),
  ]);
  const detected = capabilities(cameraId);
  const profiles = (cam.profiles || []).map((profile) => ({
    token: profile?.$?.token,
    name: profile?.name,
    fixed: profile?.$?.fixed,
    videoSourceConfiguration: profile?.videoSourceConfiguration,
    videoEncoderConfiguration: profile?.videoEncoderConfiguration,
    audioSourceConfiguration: profile?.audioSourceConfiguration,
    audioEncoderConfiguration: profile?.audioEncoderConfiguration,
    audioOutputConfiguration: profile?.audioOutputConfiguration,
    ptzConfiguration: profile?.PTZConfiguration || profile?.ptzConfiguration,
  }));
  return plain({
    fetchedAt: new Date().toISOString(),
    deviceInformation: deviceInformation || cam.deviceInformation || null,
    capabilities: {
      ...detected,
      lightCommands: undefined,
      audioInput: Array.isArray(audioSources) && audioSources.length > 0,
      audioOutput: Array.isArray(audioOutputs) && audioOutputs.length > 0,
      onvif: cam.capabilities || null,
    },
    profiles,
    audioSources: audioSources || [],
    audioOutputs: audioOutputs || [],
    imaging,
    presets: presets || {},
    auxiliaryCommands: detected.lightCommands || [],
  });
}

function reconnect(camera, onReady) {
  stopPatrol(camera.id);
  cancelBlink(camera.id);
  const old = connections.get(camera.id);
  connections.delete(camera.id);
  try { old?.removeAllListeners(); } catch {}
  connectOne(camera, onReady);
}

function remove(cameraId) {
  stopPatrol(cameraId);
  cancelBlink(cameraId);
  lightModeStates.delete(cameraId);
  lightStateHints.delete(cameraId);
  const old = connections.get(cameraId);
  connections.delete(cameraId);
  extras.delete(cameraId);
  try { old?.removeAllListeners(); } catch {}
}

function move(cameraId, x, y, zoom = 0, durationMs = 500) {
  const cam = connections.get(cameraId);
  if (!cam) return false;
  cam.continuousMove({ x, y, zoom });
  setTimeout(() => cam.stop(), durationMs);
  return true;
}

function stop(cameraId) {
  const cam = connections.get(cameraId);
  if (!cam) return false;
  cam.stop();
  return true;
}

function capabilities(cameraId) {
  const cam = connections.get(cameraId);
  if (!cam) return { online: false, ptz: false, light: false, talk: false, alarm: false };
  const commands = cam.serviceCapabilities?.auxiliaryCommands || [];
  const lightCommands = commands.filter((command) => /light|illumin|lamp|spot/i.test(command));
  const extra = extras.get(cameraId) || {};
  return {
    online: true,
    ptz: Boolean(cam.activeSource?.ptz),
    light: lightCommands.length >= 2 || Boolean(extra.dahuaLight),
    lightCommands,
    talk: Boolean(extra.audioOutput),
    alarm: Boolean(extra.relayOutputs?.length || extra.dahuaAlarm),
    lightModes: extra.dahuaLight ? ["auto", "on", "off", "blink"] : [],
    patrol: Boolean(cam.activeSource?.ptz),
  };
}

async function lightState(cameraId) {
  const hint = lightStateHints.get(cameraId);
  if (hint?.expiresAt > Date.now()) return hint.enabled;
  lightStateHints.delete(cameraId);
  const extra = extras.get(cameraId) || {};
  if (!connections.get(cameraId) || !extra.camera || !extra.dahuaLight) return null;
  return dahua.getLightState(extra.camera, extra.dahuaLight);
}

async function setLight(cameraId, enabled) {
  const cam = connections.get(cameraId);
  const extra = extras.get(cameraId) || {};
  const available = capabilities(cameraId).lightCommands || [];
  if (!cam) return false;
  if (available.length < 2 && extra.camera && extra.dahuaLight) {
    const changed = await dahua.setLight(extra.camera, extra.dahuaLight, enabled);
    if (changed) {
      lightModeStates.set(cameraId, enabled ? "on" : "off");
      rememberLightState(cameraId, enabled);
    }
    return changed;
  }
  if (available.length < 2) return false;
  const wanted = available.find((command) => enabled ? /on|start|enable/i.test(command) : /off|stop|disable/i.test(command));
  if (!wanted) return false;
  return new Promise((resolve) => {
    cam.ptzSendAuxiliaryCommand({ data: wanted }, (err) => {
      if (!err) {
        lightModeStates.set(cameraId, enabled ? "on" : "off");
        rememberLightState(cameraId, enabled);
      }
      resolve(!err);
    });
  });
}

async function setLightMode(cameraId, mode, intervalMs = 700) {
  const extra = extras.get(cameraId) || {};
  if (!extra.camera || !extra.dahuaLight) return false;
  // Wait for a toggle already sent by the old blink loop. Otherwise that
  // delayed request can finish after a later On/Off/Auto command and undo it.
  const pendingBlink = cancelBlink(cameraId);
  if (pendingBlink) await pendingBlink.catch(() => {});
  if (mode !== "blink") {
    const changed = await dahua.setLightMode(extra.camera, extra.dahuaLight, mode);
    if (changed) {
      lightModeStates.set(cameraId, mode);
      if (mode === "on" || mode === "off") rememberLightState(cameraId, mode === "on");
      else lightStateHints.delete(cameraId);
    }
    return changed;
  }
  let enabled = true;
  if (!await dahua.setLight(extra.camera, extra.dahuaLight, true)) return false;
  rememberLightState(cameraId, true);
  const delay = Math.max(300, Math.min(5000, Number(intervalMs) || 700));
  const state = { timer: null, pending: null, cancelled: false };
  const toggle = async () => {
    if (state.cancelled) return;
    enabled = !enabled;
    state.pending = dahua.setLight(extra.camera, extra.dahuaLight, enabled);
    try {
      if (await state.pending) rememberLightState(cameraId, enabled);
    } catch {}
    finally { state.pending = null; }
    if (!state.cancelled) state.timer = setTimeout(toggle, delay);
  };
  state.timer = setTimeout(toggle, delay);
  blinkers.set(cameraId, state);
  lightModeStates.set(cameraId, "blink");
  return true;
}

function lightModeState(cameraId) {
  return lightModeStates.get(cameraId) || null;
}

function setAlarm(cameraId, active) {
  const cam = connections.get(cameraId);
  const extra = extras.get(cameraId);
  const token = extra?.relayOutputs?.[0];
  if (extra?.dahuaAlarm && extra.camera) return dahua.setAlarm(extra.camera, active);
  if (!cam || !token || !extra.deviceIOUrl) return Promise.resolve(false);
  return new Promise((resolve) => {
    cam._request({
      url: extra.deviceIOUrl,
      body: cam._envelopeHeader() +
        `<SetRelayOutputState xmlns="http://www.onvif.org/ver10/deviceIO/wsdl">` +
        `<RelayOutputToken>${token}</RelayOutputToken><LogicalState>${active ? "active" : "inactive"}</LogicalState>` +
        `</SetRelayOutputState>` + cam._envelopeFooter(),
    }, (err) => resolve(!err));
  });
}

async function alarmState(cameraId) {
  const extra = extras.get(cameraId);
  return extra?.dahuaAlarm && extra.camera ? dahua.getAlarmState(extra.camera) : null;
}

async function presets(cameraId) {
  const cam = connections.get(cameraId);
  return cam?.activeSource?.ptz ? ((await call(cam, "getPresets", {})) || {}) : null;
}

function stopPatrol(cameraId) {
  const state = patrols.get(cameraId);
  if (state?.timer) clearInterval(state.timer);
  patrols.delete(cameraId);
  return Boolean(state);
}

async function startPatrol(cameraId, tokens, intervalSeconds = 15) {
  if (!connections.get(cameraId) || !Array.isArray(tokens) || tokens.length < 2) return false;
  stopPatrol(cameraId);
  const intervalMs = Math.max(5, Math.min(3600, Number(intervalSeconds) || 15)) * 1000;
  let index = 0;
  const visit = () => gotoPreset(cameraId, tokens[index++ % tokens.length]);
  if (!await visit()) return false;
  const timer = setInterval(() => visit().catch(() => {}), intervalMs);
  patrols.set(cameraId, { timer, tokens, intervalSeconds: intervalMs / 1000, startedAt: new Date().toISOString() });
  return true;
}

function patrolState(cameraId) {
  const state = patrols.get(cameraId);
  return state ? { active: true, tokens: state.tokens, intervalSeconds: state.intervalSeconds, startedAt: state.startedAt } : { active: false };
}

function home(cameraId) {
  const cam = connections.get(cameraId);
  if (!cam || typeof cam.gotoHomePosition !== "function") return Promise.resolve(false);
  return new Promise((resolve) => cam.gotoHomePosition({}, (err) => resolve(!err)));
}

function gotoPreset(cameraId, preset) {
  const cam = connections.get(cameraId);
  if (!cam || typeof cam.gotoPreset !== "function" || !preset) return Promise.resolve(false);
  return new Promise((resolve) => cam.gotoPreset({ preset: String(preset) }, (err) => resolve(!err)));
}

function setPreset(cameraId, name) {
  const cam = connections.get(cameraId);
  if (!cam || typeof cam.setPreset !== "function" || !name) return Promise.resolve(false);
  return new Promise((resolve) => cam.setPreset({ presetName: String(name).slice(0, 80) }, (err, result) => resolve(err ? false : (result?.presetToken || true))));
}

module.exports = { connectAll, reconnect, remove, move, stop, capabilities, lightState, lightModeState, inventory, setLight, setLightMode, alarmState, setAlarm, home, gotoPreset, setPreset, presets, startPatrol, stopPatrol, patrolState };
