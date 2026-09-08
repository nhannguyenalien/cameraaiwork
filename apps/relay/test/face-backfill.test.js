const test = require("node:test");
const assert = require("node:assert/strict");
const { addDistinct } = require("../src/face-backfill");

test("addDistinct merges repeated faces from video frames", () => {
  const faces = [];
  addDistinct(faces, [{ embedding: [1, 0] }, { embedding: [0, 1] }]);
  addDistinct(faces, [{ embedding: [0.99, 0.01] }, [0, 1]]);
  assert.deepEqual(faces, [[1, 0], [0, 1]]);
});
