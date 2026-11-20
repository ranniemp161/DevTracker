import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import worker from './worker.mjs';

const key = 'task-media/12345678-abcd-abcd-abcd-123456789abc';
const secret = 'local-test-secret';
const origin = 'https://media.example.test';

function signedUrl(expires) {
  const signature = createHmac('sha256', secret).update(`${key}:${expires}`).digest('hex');
  return `${origin}/${key}?expires=${expires}&signature=${signature}`;
}

test('authorizes before reading the edge cache and supports range delivery', async () => {
  const body = new Uint8Array([1, 2, 3, 4]);
  const pending = [];
  let cached;
  let reads = 0;
  const previousCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async () => cached?.clone(),
      put: async (_, response) => {
        cached = new Response(await response.arrayBuffer(), { headers: response.headers });
      },
    },
  };

  const env = {
    TASK_MEDIA_CDN_SECRET: secret,
    TASK_MEDIA: {
      head: async () => ({ size: body.length }),
      get: async (objectKey, { range } = {}) => {
        assert.equal(objectKey, key);
        reads++;
        return {
          size: body.length,
          body: range ? body.slice(range.offset, range.offset + range.length) : body,
          httpMetadata: { contentType: 'image/png' },
        };
      },
    },
  };
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const now = Math.floor(Date.now() / 1000);
  const valid = signedUrl(now + 60);

  try {
    const first = await worker.fetch(new Request(valid), env, ctx);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(new Uint8Array(await first.arrayBuffer()), body);
    await Promise.all(pending);

    assert.equal((await worker.fetch(new Request(signedUrl(now - 1)), env, ctx)).status, 404);
    const wrong = new URL(valid);
    wrong.searchParams.set('signature', '0'.repeat(64));
    assert.equal((await worker.fetch(new Request(wrong), env, ctx)).status, 404);

    const hit = await worker.fetch(new Request(valid), env, ctx);
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get('Cache-Control'), 'private, no-store');
    await hit.arrayBuffer();
    assert.equal(reads, 1);

    const request = new Request(valid, { headers: { Range: 'bytes=1-2' } });
    const part = await worker.fetch(request, env, ctx);
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('Content-Range'), 'bytes 1-2/4');
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), body.slice(1, 3));
  } finally {
    if (previousCaches) globalThis.caches = previousCaches;
    else delete globalThis.caches;
  }
});
