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
  assert.deepEqual(result, {
    hasPerson: true,
    hasVehicle: false,
    vehicleBoxes: [],
    faceEmbedding: [0.1, 0.2],
    faceEmbeddings: [[0.1, 0.2]],
    faceDetections: [{ embedding: [0.1, 0.2], box: null }],
  });
});

test("detection keeps every face returned by the local worker", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    hasPerson: true,
    faceEmbedding: [0.1, 0.2],
    faceEmbeddings: [
      { embedding: [0.1, 0.2], box: [1, 2, 3, 4] },
      { embedding: [0.8, 0.9], box: [5, 6, 7, 8] },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const result = await detectPerson({ AI_WORKER_URL: "http://ai.local" }, {}, new Uint8Array([1]));
  assert.deepEqual(result.faceEmbeddings, [[0.1, 0.2], [0.8, 0.9]]);
  assert.deepEqual(result.faceDetections, [
    { embedding: [0.1, 0.2], box: [1, 2, 3, 4] },
    { embedding: [0.8, 0.9], box: [5, 6, 7, 8] },
  ]);
});

test("detection endpoints are normalized and de-duplicated", () => {
  assert.deepEqual(detectionWorkerUrls({}, {
    ai_worker_url: "https://site.example/internal/ai/",
    relay_url: "https://site.example/",
  }), ["https://site.example/internal/ai"]);
});
