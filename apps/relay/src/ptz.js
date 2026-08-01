const { Cam } = require("onvif");
const config = require("./config");

const connections = new Map(); // camera id -> Cam instance

function connectAll() {
  for (const camera of config.cameras) {
    connectOne(camera);
  }
}

function connectOne(camera) {
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
        setTimeout(() => connectOne(camera), 5000);
        return;
      }
      connections.set(camera.id, this);
      console.log(`✅ ONVIF PTZ sẵn sàng: ${camera.id}`);
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

module.exports = { connectAll, move, stop };
