import assert from "node:assert/strict";
import test from "node:test";
import { detectPerson, detectionWorkerUrls } from "../functions/_lib/detection.js";

test("detection falls back from a stale AI hostname to AI behind the relay", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url.startsWith("https://old-ai.example")) throw new Error("DNS failure");
    return new Response(JSON.stringify({ hasPerson: true, faceEmbedding: [0.1, 0.2] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await detectPerson({}, {
    ai_worker_url: "https://old-ai.example/",
    relay_url: "https://site-relay.example/",
    relay_secret: "test-secret",
  }, new Uint8Array([1, 2, 3]));

  assert.deepEqual(calls, [
    "https://old-ai.example/detect",
    "https://site-relay.example/internal/ai/detect",
  ]);
  assert.deepEqual(result, { hasPerson: true, faceEmbedding: [0.1, 0.2] });
});

test("detection endpoints are normalized and de-duplicated", () => {
  assert.deepEqual(detectionWorkerUrls({}, {
    ai_worker_url: "https://site.example/internal/ai/",
    relay_url: "https://site.example/",
  }), ["https://site.example/internal/ai"]);
});
