const test = require("node:test");
const assert = require("node:assert/strict");
const { lanPrefixes, publicDevice } = require("../src/discovery");

test("publicDevice exposes only connection coordinates", () => {
  const device = publicDevice({ hostname: "192.168.2.23", port: 2020, path: "/onvif/device_service", urn: "uuid:test", username: "hidden" });
  assert.deepEqual(device, { ip: "192.168.2.23", onvifPort: 2020, onvifPath: "/onvif/device_service", urn: "uuid:test" });
  assert.equal("username" in device, false);
});

test("lanPrefixes scans physical private LANs and ignores container networks", () => {
  assert.deepEqual(lanPrefixes({
    eth0: [{ family: "IPv4", address: "192.168.2.8", internal: false }],
    "br-test": [{ family: "IPv4", address: "10.0.1.1", internal: false }],
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  }), ["192.168.2"]);
});
