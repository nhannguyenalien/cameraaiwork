const test = require("node:test");
const assert = require("node:assert/strict");
const { publicDevice } = require("../src/discovery");

test("publicDevice exposes only connection coordinates", () => {
  const device = publicDevice({ hostname: "192.168.2.23", port: 2020, path: "/onvif/device_service", urn: "uuid:test", username: "hidden" });
  assert.deepEqual(device, { ip: "192.168.2.23", onvifPort: 2020, onvifPath: "/onvif/device_service", urn: "uuid:test" });
  assert.equal("username" in device, false);
});
