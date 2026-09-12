import assert from "node:assert/strict";
import test from "node:test";
import { chatGemini, chatOpenAI } from "../functions/_lib/agentChat.js";

test("OpenAI chat executes read tools and returns their grounded answer", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    requestCount += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    if (requestCount === 1) return Response.json({ model: "gpt-test", output: [{ type: "function_call", name: "list_sites", call_id: "call-1", arguments: "{}" }] });
    assert.equal(body.input.at(-1).type, "function_call_output");
    return Response.json({ model: "gpt-test", output_text: "Có một site đang hoạt động.", output: [] });
  };
  const executed = [];
  const result = await chatOpenAI({ apiKey: "test" }, [{ role: "user", content: "Có site nào?" }], async (action) => {
    executed.push(action);
    return [{ id: "st-1" }];
  });
  assert.deepEqual(executed, ["list_sites"]);
  assert.equal(result.answer, "Có một site đang hoạt động.");
});

test("OpenAI chat returns camera writes as confirmation proposals", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ model: "gpt-test", output: [{
    type: "function_call", name: "add_camera", call_id: "call-2",
    arguments: JSON.stringify({ siteId: "st-1", name: "Cổng", ip: "192.168.1.20", username: "admin", password: "secret", rtspPort: 554, onvifPort: 80, rtspPath: "/stream", autoConfigure: true }),
  }] });
  let executed = false;
  const result = await chatOpenAI({ apiKey: "test" }, [{ role: "user", content: "Thêm camera" }], async () => { executed = true; });
  assert.equal(executed, false);
  assert.equal(result.proposals[0].action, "add_camera");
});

test("Gemini tool schemas use its nullable schema format", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(body.systemInstruction);
    assert.match(body.systemInstruction.parts[0].text, /2026-09-09T10:00:00\+07:00/);
    assert.match(body.systemInstruction.parts[0].text, /luôn dùng summarize_events/i);
    assert.equal("system_instruction" in body, false);
    const label = body.tools[0].functionDeclarations.find((tool) => tool.name === "label_person");
    assert.equal(label.parameters.properties.label.type, "string");
    assert.equal(label.parameters.properties.label.nullable, true);
    assert.equal("additionalProperties" in label.parameters, false);
    const updateConfig = body.tools[0].functionDeclarations.find((tool) => tool.name === "update_camera_config");
    assert.equal("minProperties" in updateConfig.parameters.properties.config, false);
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "Đã hiểu." }] } }] });
  };
  const result = await chatGemini(
    { apiKey: "test" },
    [{ role: "user", content: "Xin chào" }],
    async () => ({}),
    { now: new Date("2026-09-09T03:00:00.000Z"), timezoneOffsetMinutes: 420 },
  );
  assert.equal(result.answer, "Đã hiểu.");
});

test("OpenAI receives camera images inline without exposing base64 in tool results", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    requestCount += 1;
    const body = JSON.parse(options.body);
    if (requestCount === 1) return Response.json({ model: "gpt-test", output: [{
      type: "function_call", name: "inspect_camera_snapshot", call_id: "vision-1",
      arguments: JSON.stringify({ siteId: "site-1", cameraId: "cam-1", question: "Có ai ở cửa?" }),
    }] });
    const imageMessage = body.input.at(-1);
    assert.equal(imageMessage.content[0].type, "input_text");
    assert.equal(imageMessage.content[1].type, "input_image");
    assert.equal(imageMessage.content[1].image_url, "data:image/jpeg;base64,aW1hZ2U=");
    assert.doesNotMatch(JSON.stringify(body.input.at(-2)), /aW1hZ2U=/);
    return Response.json({ model: "gpt-test", output_text: "Có một người ở cửa.", output: [] });
  };
  const result = await chatOpenAI({ apiKey: "test" }, [{ role: "user", content: "Có ai ở cửa?" }], async () => ({
    __agentMedia: { kind: "image", mimeType: "image/jpeg", data: "aW1hZ2U=", size: 5, question: "Có ai ở cửa?", source: { type: "camera_snapshot" } },
  }));
  assert.equal(result.answer, "Có một người ở cửa.");
  assert.equal(result.toolResults[0].result.mediaAttached, true);
  assert.doesNotMatch(JSON.stringify(result.toolResults), /aW1hZ2U=/);
});

test("Gemini receives short event videos as inline data", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    requestCount += 1;
    const body = JSON.parse(options.body);
    if (requestCount === 1) return Response.json({ candidates: [{ content: { role: "model", parts: [{ functionCall: {
      name: "inspect_event_media", id: "video-1", args: { eventId: "evt-1", mediaType: "video" },
    } }] } }] });
    const parts = body.contents.at(-1).parts;
    assert.equal(parts.find((part) => part.inlineData)?.inlineData.mimeType, "video/mp4");
    assert.equal(parts.find((part) => part.inlineData)?.inlineData.data, "dmlkZW8=");
    assert.doesNotMatch(JSON.stringify(parts.find((part) => part.functionResponse)), /dmlkZW8=/);
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "Một người đi vào lúc đầu clip." }] } }] });
  };
  const result = await chatGemini({ apiKey: "test" }, [{ role: "user", content: "Xem clip event" }], async () => ({
    __agentMedia: { kind: "video", mimeType: "video/mp4", data: "dmlkZW8=", size: 5, question: "Mô tả clip", source: { type: "event", eventId: "evt-1" } },
  }));
  assert.equal(result.answer, "Một người đi vào lúc đầu clip.");
  assert.equal(result.toolResults[0].result.kind, "video");
});
