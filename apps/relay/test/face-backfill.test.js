const test = require("node:test");
const assert = require("node:assert/strict");
const { addDistinct } = require("../src/face-backfill");

test("addDistinct merges repeated faces from video frames", () => {
  const faces = [];
  addDistinct(faces, [{ embedding: [1, 0] }, { embedding: [0, 1] }]);
  addDistinct(faces, [{ embedding: [0.99, 0.01] }, [0, 1]]);
  assert.deepEqual(faces, [
    { embedding: [1, 0], box: null },
    { embedding: [0, 1], box: null },
  ]);
});

test("addDistinct preserves the face box from the event image", () => {
  const faces = [];
  addDistinct(faces, [{ embedding: [1, 0], box: [10, 20, 50, 80] }]);
  assert.deepEqual(faces[0].box, [10, 20, 50, 80]);
});

test("addDistinct merges camera-quality samples of the same face", () => {
  const faces = [];
  addDistinct(faces, [{ embedding: [1, 0], box: [1, 2, 3, 4] }]);
  addDistinct(faces, [{ embedding: [0.4, Math.sqrt(0.84)], box: [5, 6, 7, 8] }]);
  assert.equal(faces.length, 1);
  assert.deepEqual(faces[0].box, [1, 2, 3, 4]);
});

test("addDistinct merges samples above the production threshold", () => {
  const faces = [];
  addDistinct(faces, [{ embedding: [1, 0] }]);
  addDistinct(faces, [{ embedding: [0.31, Math.sqrt(1 - 0.31 ** 2)] }]);
  assert.equal(faces.length, 1);
});

test("addDistinct keeps faces below the production threshold separate", () => {
  const faces = [];
  addDistinct(faces, [{ embedding: [1, 0] }]);
  addDistinct(faces, [{ embedding: [0.29, Math.sqrt(1 - 0.29 ** 2)] }]);
  assert.equal(faces.length, 2);
});
