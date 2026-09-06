import assert from "node:assert/strict";
import test from "node:test";
import { orphanTunnelCandidates } from "../functions/_lib/cloudflareTunnel.js";

test("cleanup selects only unreferenced tunnels older than the grace period", () => {
  const tunnels = [
    { id: "used", created_at: "2026-08-20T00:00:00Z" },
    { id: "orphan-old", created_at: "2026-08-20T00:00:00Z" },
    { id: "orphan-new", created_at: "2026-08-22T11:30:00Z" },
    { id: "unknown-age", created_at: "invalid" },
  ];
  const result = orphanTunnelCandidates(tunnels, new Set(["used"]), Date.parse("2026-08-22T11:00:00Z"));
  assert.deepEqual(result.map((item) => item.id), ["orphan-old"]);
});
