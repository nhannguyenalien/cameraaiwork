import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../functions/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("level-2 agent keeps provider credentials, history, and SchoolsAI sessions account-scoped", async () => {
  const chat = await source("api/agent/chat.js");
  assert.match(chat, /credentials\(context\.env, context\.data\.accountId\)/);
  assert.match(chat, /listAgentMessages\(env, data\.accountId/);
  assert.match(chat, /saveAgentMessage\(env, data\.accountId/);
  assert.match(chat, /cameraai-operator-\$\{context\.data\.accountId\}-\$\{clientRequestId\}/);
});

test("all agent read and media tools preserve the authenticated account boundary", async () => {
  const [actions, sites, siteHelpers, people, events, image, video] = await Promise.all([
    source("api/agent/actions.js"),
    source("api/sites/index.js"),
    source("_lib/sites.js"),
    source("api/people/index.js"),
    source("api/events/index.js"),
    source("api/events/[id]/image.js"),
    source("api/events/[id]/video.js"),
  ]);

  assert.match(actions, /getCamera\(env, data\.accountId, args\.siteId, args\.cameraId\)/);
  assert.match(actions, /summarizeEvents\(env, data\.accountId, args\)/);
  assert.match(sites, /WHERE s\.account_id = \?/);
  assert.match(siteHelpers, /WHERE id = \? AND account_id = \?/);
  assert.match(siteHelpers, /WHERE id = \? AND site_id = \? AND account_id = \?/);
  assert.match(siteHelpers, /WHERE cameras\.account_id = \?/);
  assert.match(people, /people\.account_id = \?/);
  assert.match(events, /eventWhere\(data\.accountId/);
  assert.match(image, /WHERE id = \? AND account_id = \?/);
  assert.match(video, /WHERE id = \? AND account_id = \?/);
});

test("all agent write tools re-check account ownership at the mutation boundary", async () => {
  const [person, settings, cameraConfig, ptz, discovery, addCamera] = await Promise.all([
    source("api/people/[id].js"),
    source("api/cameras/[site]/[camera]/settings.js"),
    source("api/cameras/[site]/[camera]/config.js"),
    source("api/cameras/[site]/[camera]/ptz.js"),
    source("api/sites/[id]/discover.js"),
    source("api/sites/[id]/cameras/index.js"),
  ]);

  assert.match(person, /SELECT id FROM \$\{table\} WHERE id = \? AND account_id = \?/);
  assert.match(person, /UPDATE \$\{table\} SET label = \? WHERE id = \? AND account_id = \?/);
  assert.match(settings, /getCamera\(env, data\.accountId/);
  assert.match(settings, /WHERE id = \? AND site_id = \? AND account_id = \?/);
  assert.match(cameraConfig, /getSite\(env, data\.accountId/);
  assert.match(cameraConfig, /getCamera\(env, data\.accountId/);
  assert.match(ptz, /getSite\(env, data\.accountId/);
  assert.match(ptz, /getCamera\(env, data\.accountId/);
  assert.match(discovery, /getSite\(env, data\.accountId/);
  assert.match(addCamera, /getSite\(env, data\.accountId/);
  assert.match(addCamera, /VALUES \(\?, \?, \?, \?, \?\)/);
  assert.match(addCamera, /args: \[cameraId, params\.id, data\.accountId/);
});

test("mutating tools remain confirmation-gated before execution", async () => {
  const actions = await source("api/agent/actions.js");
  assert.match(actions, /requiresAgentConfirmation\(action\) && body\.confirmed !== true/);
  assert.match(actions, /status: 428/);
});
