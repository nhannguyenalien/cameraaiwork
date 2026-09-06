import assert from "node:assert/strict";
import test from "node:test";
import { decryptConfig, encryptConfig } from "../functions/_lib/integrations.js";

const key = Buffer.alloc(32, 7).toString("base64");

test("customer integration credentials round-trip through AES-GCM", async () => {
  const config = { botToken: "secret-token", chatId: "12345" };
  const encrypted = await encryptConfig({ CUSTOMER_SECRETS_KEY: key }, config);

  assert.equal(encrypted.includes(config.botToken), false);
  assert.deepEqual(await decryptConfig({ CUSTOMER_SECRETS_KEY: key }, encrypted), config);
});

test("customer integration credentials cannot be decrypted with another key", async () => {
  const encrypted = await encryptConfig({ CUSTOMER_SECRETS_KEY: key }, { apiKey: "private" });
  const otherKey = Buffer.alloc(32, 8).toString("base64");

  await assert.rejects(() => decryptConfig({ CUSTOMER_SECRETS_KEY: otherKey }, encrypted));
});
