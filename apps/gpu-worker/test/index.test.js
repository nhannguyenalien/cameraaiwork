import test from "node:test";
import assert from "node:assert/strict";
import { cosine } from "../src/index.js";

test("cosine distinguishes same and opposite embeddings", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
});
