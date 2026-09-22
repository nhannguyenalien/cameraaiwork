import assert from "node:assert/strict";
import test from "node:test";
import { chatSchoolsOperator, chatSchoolsSupport } from "../functions/_lib/schoolsAi.js";

const REQUEST_1 = "11111111-1111-4111-8111-111111111111";
const REQUEST_2 = "22222222-2222-4222-8222-222222222222";
const REQUEST_3 = "33333333-3333-4333-8333-333333333333";

test("public support proxies a session and question without exposing the key in the body", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://apic.schoolsai.work/api/v1/chat");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.session, "visitor-1");
    assert.match(body.question, /Câu hỏi khách hàng: Bảng giá\?/);
    assert.match(body.question, /không tự bịa giá/i);
    assert.doesNotMatch(options.body, /test-key/);
    return Response.json({ success: true, reply: "Có gói Free và Pro." });
  };
  const result = await chatSchoolsSupport({ SCHOOLSAI_API_KEY: "test-key" }, { session: "visitor-1", question: "Bảng giá?" });
  assert.equal(result.answer, "Có gói Free và Pro.");
});

test("operator executes read tools locally and feeds the result back", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.session, "account-1");
    assert.equal(body.request_id, REQUEST_1);
    if (calls === 1) return Response.json({ request_id: REQUEST_1, type: "tool", tool_call_id: "tool-1", name: "list_sites", args: {} });
    assert.match(body.messages.at(-1).content, /tool_result/);
    assert.match(body.messages.at(-1).content, /tool-1/);
    return Response.json({ request_id: REQUEST_1, type: "answer", answer: "Có một site.", finish_reason: "stop" });
  };
  const executed = [];
  const result = await chatSchoolsOperator({ SCHOOLSAI_API_KEY: "test-key" }, {
    requestId: REQUEST_1, session: "account-1", messages: [{ role: "user", content: "Có site nào?" }],
    execute: async (action) => { executed.push(action); return [{ id: "site-1" }]; },
  });
  assert.deepEqual(executed, ["list_sites"]);
  assert.equal(result.answer, "Có một site.");
});

test("operator returns write actions for local confirmation", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ request_id: REQUEST_2, type: "tool", tool_call_id: "tool-2", name: "label_person", args: { personId: "p1", label: "Nam" } });
  let executed = false;
  const result = await chatSchoolsOperator({ SCHOOLSAI_API_KEY: "test-key" }, {
    requestId: REQUEST_2, session: "account-1", messages: [{ role: "user", content: "Đặt tên Nam" }], execute: async () => { executed = true; },
  });
  assert.equal(executed, false);
  assert.deepEqual(result.proposals, [{ action: "label_person", args: { personId: "p1", label: "Nam" } }]);
});

test("operator rejects a response belonging to another request", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ request_id: "wrong-request", type: "answer", answer: "Sai lượt." });
  await assert.rejects(
    chatSchoolsOperator({ SCHOOLSAI_API_KEY: "test-key" }, {
      requestId: REQUEST_3, session: "account-1", messages: [{ role: "user", content: "Xin chào" }], execute: async () => null,
    }),
    /sai request_id/i,
  );
});

test("operator tolerates a tool directive wrapped in an answer response", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (calls === 1) {
      return Response.json({ request_id: REQUEST_3, type: "answer", answer: '{"tool":"list_sites","args":{}}', finish_reason: "stop" });
    }
    const toolResult = JSON.parse(body.messages.at(-1).content);
    assert.match(toolResult.tool_call_id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(toolResult.tool_result, [{ id: "site-1" }]);
    return Response.json({ request_id: REQUEST_3, type: "answer", answer: "Có một site.", finish_reason: "stop" });
  };
  const result = await chatSchoolsOperator({ SCHOOLSAI_API_KEY: "test-key" }, {
    requestId: REQUEST_3, session: "account-1", messages: [{ role: "user", content: "Liệt kê site" }],
    execute: async () => [{ id: "site-1" }],
  });
  assert.equal(result.answer, "Có một site.");
});
