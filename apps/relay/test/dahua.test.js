const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDigestChallenge, digestAuthorization, rpcLoginResponse, parseWhiteLightKeys, parseLightState } = require("../src/dahua");

test("parses Dahua Digest challenge", () => {
  const parsed = parseDigestChallenge('Digest realm="Login to Dahua", qop="auth", nonce="abc", opaque="xyz"');
  assert.deepEqual(parsed, { realm: "Login to Dahua", qop: "auth", nonce: "abc", opaque: "xyz" });
});

test("builds the Dahua RPC2 challenge response", () => {
  const ha1 = require("crypto").createHash("md5").update("admin:realm:secret").digest("hex").toUpperCase();
  const expected = require("crypto").createHash("md5").update(`admin:random:${ha1}`).digest("hex").toUpperCase();
  assert.equal(rpcLoginResponse("admin", "realm", "secret", "random"), expected);
});

test("builds a Digest authorization header without exposing the password", () => {
  const header = digestAuthorization({ realm: "Dahua", nonce: "abc", qop: "auth" }, "admin", "secret", "GET", "/cgi-bin/test");
  assert.match(header, /^Digest /);
  assert.match(header, /username="admin"/);
  assert.match(header, /qop=auth/);
  assert.doesNotMatch(header, /secret/);
});

test("parses the physical Dahua white-light state", () => {
  assert.equal(parseLightState({ params: { status: { WhiteLight: "On" } } }), true);
  assert.equal(parseLightState({ params: { status: { WhiteLight: "Off" } } }), false);
  assert.equal(parseLightState({ params: { status: {} } }), null);
});

test("finds every Dahua WhiteLight profile", () => {
  const config = [
    "table.Lighting_V2[0][0][1].LightType=WhiteLight",
    "table.Lighting_V2[0][0][2].LightType=AIMixLight",
    "table.Lighting_V2[0][1][1].LightType=WhiteLight",
    "table.Lighting_V2[0][2][1].LightType=WhiteLight",
  ].join("\r\n");
  assert.deepEqual(parseWhiteLightKeys(config), [
    "Lighting_V2[0][0][1]",
    "Lighting_V2[0][1][1]",
    "Lighting_V2[0][2][1]",
  ]);
});
