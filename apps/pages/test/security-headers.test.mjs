import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard CSP permits signed live players from site relay hostnames", async () => {
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  const csp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1] || "";

  assert.match(csp, /(?:^|;)\s*frame-src\s+[^;]*'self'[^;]*https:\/\/\*\.schoolsai\.work(?:\s|;|$)/);
  assert.match(csp, /(?:^|;)\s*frame-ancestors\s+'none'(?:\s|;|$)/);
});
