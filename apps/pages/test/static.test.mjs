import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createStatic } from '../server/static.js';

const serve = createStatic(fileURLToPath(new URL('../public', import.meta.url)), {});
for (const [source, target] of [
  ['/camera.html', '/camera'],
  ['/index.html', '/'],
  ['/docs/index.html', '/docs/'],
  ['/docs', '/docs/'],
]) {
  test(`clean URL redirect preserves query parameters: ${source}`, async () => {
    const query = '?site=home%2F1&camera=front%20door&tag=a&tag=b';
    const response = await serve(new Request(`https://example.com${source}${query}`));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), `https://example.com${target}${query}`);
  });
}
test('canonical camera URL serves the detail page without redirecting', async () => {
  const response = await serve(new Request('https://example.com/camera?site=home&camera=front', { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
});
