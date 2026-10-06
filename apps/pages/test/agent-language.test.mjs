import assert from 'node:assert/strict';
import test from 'node:test';
import { chatOpenAI, chatGemini } from '../functions/_lib/agentChat.js';
import { chatSchoolsOperator } from '../functions/_lib/schoolsAi.js';

for (const [language, expected] of Object.entries({vi:'Vietnamese',en:'English',ja:'Japanese',fr:'French',ko:'Korean',es:'Spanish',invalid:'Vietnamese'})) {
  test(`all chat providers receive selected language: ${language}`, async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    const requestId = '11111111-1111-4111-8111-111111111111';
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const prompt = body.instructions || body.systemInstruction?.parts[0].text || JSON.stringify(body.messages);
      assert.ok(prompt.includes(`Respond to the user in ${expected}.`));
      assert.doesNotMatch(prompt, /Luôn trả lời tiếng Việt|noi_dung_tieng_Viet/);
      if (url.includes('openai.com')) return Response.json({output_text:'OK'});
      if (url.includes('googleapis.com')) return Response.json({candidates:[{content:{parts:[{text:'OK'}]}}]});
      return Response.json({request_id:requestId,type:'answer',answer:'OK'});
    };
    const messages = [{role:'assistant',content:'Xin chào'},{role:'user',content:'Camera?'}];
    const execute = async () => { throw new Error('Unexpected tool call'); };
    await chatOpenAI({apiKey:'test'}, messages, execute, {language});
    await chatGemini({apiKey:'test'}, messages, execute, {language});
    await chatSchoolsOperator({SCHOOLSAI_API_KEY:'test'}, {requestId,session:'test',messages,execute,runtime:{language}});
  });
}
