const axios = require("axios");
const config = require("../config");

const { internalUrl, stream } = config.go2rtc;

async function getFrame() {
  const res = await axios.get(`${internalUrl}/api/frame.jpg`, {
    params: { src: stream },
    responseType: "arraybuffer",
  });
  return Buffer.from(res.data);
}

async function getClip(durationSeconds = 10) {
  const res = await axios.get(`${internalUrl}/api/stack.mp4`, {
    params: { src: stream, duration: durationSeconds },
    responseType: "arraybuffer",
  });
  return Buffer.from(res.data);
}

function watchEvents({ onEvent, onDown }) {
  let stopped = false;

  async function connect() {
    if (stopped) return;
    try {
      const response = await axios({
        method: "get",
        url: `${internalUrl}/api/events`,
        params: { src: stream },
        responseType: "stream",
        timeout: 0,
      });

      response.data.on("data", (chunk) => onEvent(chunk.toString()));
      response.data.on("end", () => retry());
      response.data.on("error", () => retry());
    } catch (e) {
      onDown?.(e);
      retry();
    }
  }

  function retry() {
    if (stopped) return;
    setTimeout(connect, 5000);
  }

  connect();

  return () => {
    stopped = true;
  };
}

module.exports = { getFrame, getClip, watchEvents };
