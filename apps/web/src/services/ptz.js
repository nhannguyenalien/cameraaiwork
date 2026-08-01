const { Cam } = require("onvif");
const config = require("../config");

let camera = null;

function connect(onReady) {
  new Cam(
    {
      hostname: config.camera.ip,
      username: config.camera.username,
      password: config.camera.password,
      port: config.camera.onvifPort,
    },
    function (err) {
      if (err) {
        console.error("❌ ONVIF PTZ lỗi:", err.message);
        setTimeout(() => connect(onReady), 5000);
        return;
      }
      camera = this;
      console.log("✅ ONVIF PTZ đã sẵn sàng!");
      onReady?.();
    }
  );
}

function move(x, y) {
  if (!camera) return;
  camera.continuousMove({ x, y, zoom: 0 });
  setTimeout(() => camera.stop(), 500);
}

function stop() {
  camera?.stop();
}

module.exports = { connect, move, stop };
