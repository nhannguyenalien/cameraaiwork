import assert from "node:assert/strict";
import test from "node:test";
import { onRequestPost } from "../functions/api/settings/integrations/models.js";

function request(body) {
  return new Request("https://example.test/api/settings/integrations/models", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("loads and filters OpenAI chat models using the entered key", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer sk-test-key");
    return Response.json({ data: [{ id: "gpt-5" }, { id: "gpt-image-1" }, { id: "text-embedding-3-small" }, { id: "o3" }] });
  };
  const response = await onRequestPost({ request: request({ provider: "openai", apiKey: "sk-test-key" }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).models, ["gpt-5", "o3"]);
});

test("loads only Gemini models that support generateContent", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["x-goog-api-key"], "AIza-test-key");
    return Response.json({ models: [
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
    ] });
  };
  const response = await onRequestPost({ request: request({ provider: "gemini", apiKey: "AIza-test-key" }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).models, ["gemini-2.5-flash"]);
});
