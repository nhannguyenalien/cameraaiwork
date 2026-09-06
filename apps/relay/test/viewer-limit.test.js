const test = require("node:test");
const assert = require("node:assert/strict");
const { createViewerLimiter } = require("../src/viewer-limit");

test("enforces viewers independently for each camera", () => {
  const viewers = createViewerLimiter();
  assert.equal(viewers.reserve("front", 1), true);
  assert.equal(viewers.reserve("front", 1), false);
  assert.equal(viewers.reserve("yard", 1), true);
  viewers.release("front");
  assert.equal(viewers.reserve("front", 1), true);
});

test("allows a Pro camera up to five concurrent viewers", () => {
  const viewers = createViewerLimiter();
  for (let index = 0; index < 5; index++) assert.equal(viewers.reserve("front", 5), true);
  assert.equal(viewers.count("front"), 5);
  assert.equal(viewers.reserve("front", 5), false);
});
