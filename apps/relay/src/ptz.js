const { Cam } = require("onvif");
const config = require("./config");

const connections = new Map(); // camera id -> Cam instance

// onReady(cameraId, camInstance) fires once ONVIF is connected — index.js
// uses it to attach the motion event listener to this same connection
// (see the note in index.js about why motion comes from ONVIF, not go2rtc).
function connectAll(onReady) {
  for (const camera of config.cameras) {
    connectOne(camera, onReady);
  }
}

function connectOne(camera, onReady) {
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
      onReady?.(camera.id, this);
    }
  );
}

function move(cameraId, x, y) {
  const cam = connections.get(cameraId);
  if (!cam) return false;
  cam.continuousMove({ x, y, zoom: 0 });
  setTimeout(() => cam.stop(), 500);
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
  if (!cam) return { online: false, ptz: false, light: false };
  const commands = cam.serviceCapabilities?.auxiliaryCommands || [];
  const lightCommands = commands.filter((command) => /light|illumin|lamp|spot/i.test(command));
  return {
    online: true,
    ptz: Boolean(cam.activeSource?.ptz),
    light: lightCommands.length >= 2,
    lightCommands,
  };
}

function setLight(cameraId, enabled) {
  const cam = connections.get(cameraId);
  const available = capabilities(cameraId).lightCommands || [];
  if (!cam || available.length < 2) return Promise.resolve(false);
  const wanted = available.find((command) => enabled ? /on|start|enable/i.test(command) : /off|stop|disable/i.test(command));
  if (!wanted) return Promise.resolve(false);
  return new Promise((resolve) => {
    cam.ptzSendAuxiliaryCommand({ data: wanted }, (err) => resolve(!err));
  });
}

module.exports = { connectAll, move, stop, capabilities, setLight };
