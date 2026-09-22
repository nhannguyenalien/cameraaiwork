import assert from "node:assert/strict";
import test from "node:test";
import { requestedMedia } from "../functions/api/agent/chat.js";

test("recording configuration is not mistaken for an image request", () => {
  assert.equal(requestedMedia("Bật ghi hình khi phát hiện người cho camera đầu tiên"), null);
  assert.equal(requestedMedia("Tắt ghi hình ở camera cổng"), null);
});

test("explicit event media requests still select the expected media kind", () => {
  assert.equal(requestedMedia("Cho tôi xem 4 ảnh event mới nhất"), "image");
  assert.equal(requestedMedia("Lấy video sự kiện sáng nay"), "video");
});
