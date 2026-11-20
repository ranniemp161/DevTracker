import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, type TestApp } from './utils/test-app';

let t: TestApp;

beforeAll(async () => {
  vi.stubEnv('R2_ACCOUNT_ID', 'test-account');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('R2_TASK_MEDIA_BUCKET', 'test-bucket');
  t = await createTestApp();
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await t?.close();
});

it('sends a file-only message, preserves bytes, and authorizes downloads against the live message', async () => {
  const client: { send(command: PutObjectCommand): Promise<unknown> } = S3Client.prototype;
  const put = vi.spyOn(client, 'send').mockResolvedValue({});
  const { admin, dev, bystander, project } = await projectFixture(t);
  const path = `/api/v1/projects/${project}/messages`;
  const file = Buffer.from('# Notes\r\nこんにちは\r\n');
  const input = {
    body: '',
    clientRequestId: 'markdown-attachment',
    attachment: { name: 'notes.md', base64: file.toString('base64') },
  };

  await bystander.browser.post(path).send(input).expect(404);
  await dev.browser
    .post(path)
    .send({
      ...input,
      attachment: { ...input.attachment, name: 'notes.html' },
    })
    .expect(400);
  put.mockRejectedValueOnce(new Error('Temporary storage failure'));
  await dev.browser.post(path).send(input).expect(500);
  const empty = await dev.browser.get(path).expect(200);
  expect(empty.body.data.messages).toEqual([]);

  const created = await dev.browser.post(path).send(input).expect(201);
  const message = created.body.data.message;
  expect(message.attachment).toEqual({ name: 'notes.md' });
  expect(put.mock.calls[1]?.[0]).toBeInstanceOf(PutObjectCommand);
  expect(put.mock.calls[1]?.[0]).toMatchObject({
    input: {
      Key: `chat-media/${message.id}`,
      Body: file,
      ContentType: 'application/octet-stream',
      ContentDisposition: "attachment; filename*=UTF-8''notes.md",
    },
  });
  const retried = await dev.browser.post(path).send(input).expect(201);
  expect(retried.body.data.message.id).toBe(message.id);
  expect(put).toHaveBeenCalledTimes(2);
  await dev.browser
    .post(path)
    .send({
      ...input,
      attachment: { ...input.attachment, base64: 'YQ==' },
    })
    .expect(409);

  const download = `/api/v1/messages/${message.id}/attachment`;
  await bystander.browser.get(download).expect(404);
  const authorized = await admin.browser.get(download).expect(200);
  expect(authorized.headers['cache-control']).toBe('private, no-store');
  const url = new URL(authorized.body.data.url);
  expect(url.pathname).toBe(`/chat-media/${message.id}`);
  expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
  await dev.browser.delete(`/api/v1/messages/${message.id}`).expect(204);
  await admin.browser.get(download).expect(404);
  const deleted = await admin.browser.get(path).expect(200);
  expect(deleted.body.data.messages[0].attachment).toBeUndefined();
});
