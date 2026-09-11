import test from "node:test";
import assert from "node:assert/strict";
import { validateS3Config } from "../functions/_lib/s3.js";

test("accepts AWS and external HTTPS S3 endpoints", () => {
  const config = validateS3Config({
    endpoint: "https://objects.example.com/",
    region: "ap-southeast-1",
    bucket: "camera-events",
    accessKeyId: "access",
    secretAccessKey: "secret",
  });
  assert.equal(config.endpoint, "https://objects.example.com");
  assert.equal(config.forcePathStyle, true);
});

test("rejects insecure and private S3 endpoints", () => {
  const base = { region: "us-east-1", bucket: "events", accessKeyId: "access", secretAccessKey: "secret" };
  assert.throws(() => validateS3Config({ ...base, endpoint: "http://s3.example.com" }), /HTTPS/);
  assert.throws(() => validateS3Config({ ...base, endpoint: "https://192.168.1.10" }), /mạng nội bộ/);
  assert.throws(() => validateS3Config({ ...base, endpoint: "https://localhost" }), /mạng nội bộ/);
});
