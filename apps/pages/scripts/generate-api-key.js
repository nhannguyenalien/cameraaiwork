#!/usr/bin/env node
// Bootstraps an API key for an account. There's no signup flow yet — this
// is the manual path: run it, paste the printed INSERT into your Turso DB.
//
//   node scripts/generate-api-key.js <account_id> [label]

const crypto = require("crypto");

const accountId = process.argv[2];
const label = process.argv[3] || "default";

if (!accountId) {
  console.error("Usage: node scripts/generate-api-key.js <account_id> [label]");
  process.exit(1);
}

const key = crypto.randomBytes(32).toString("hex");
const hash = crypto.createHash("sha256").update(key).digest("hex");

console.log("API key (gửi cho khách/lưu chỗ an toàn — không thể xem lại):\n");
console.log(`  ${key}\n`);
console.log("Chạy SQL này trên Turso (turso db shell <db-name>):\n");
console.log(
  `  INSERT INTO api_keys (id, account_id, label) VALUES ('${hash}', '${accountId}', '${label}');`
);
