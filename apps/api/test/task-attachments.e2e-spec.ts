import { CopyObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, type TestApp } from './utils/test-app';

let t: TestApp;

beforeAll(async () => {
  vi.stubEnv('R2_ACCOUNT_ID', 'test-account');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('R2_TASK_MEDIA_BUCKET', 'test-bucket');
  vi.stubEnv('TASK_MEDIA_CDN_ORIGIN', 'https://media.example.test');
  vi.stubEnv('TASK_MEDIA_CDN_SECRET', 'test-cdn-secret');
  t = await createTestApp();
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await t?.close();
});

describe('task attachments', () => {
  it('checks task access, verifies staged media, and publishes only completed attachments', async () => {
    const client: { send(command: HeadObjectCommand | CopyObjectCommand): Promise<unknown> } =
      S3Client.prototype;
    const send = vi.spyOn(client, 'send').mockImplementation(async () => {
      throw new Error('Unexpected storage request.');
    });
    const { dev, admin, bystander, project } = await projectFixture(t);
    const task = await dev.browser
      .post(`/api/v1/projects/${project}/tasks`)
      .send({ title: 'Screenshot' })
      .expect(201);
    const path = `/api/v1/tasks/${task.body.data.task.id}/attachments`;
    const image = { name: 'screen.png', size: 42, contentType: 'image/png' };

    await bystander.browser.get(path).expect(404);
    await bystander.browser.post(path).send(image).expect(404);
    await dev.browser
      .post(path)
      .send({ ...image, contentType: 'image/svg+xml' })
      .expect(400);
    const prepared = await dev.browser.post(path).send(image).expect(201);
    const { id, url, headers } = prepared.body.data;
    expect(headers).toEqual({ 'Content-Type': 'image/png', 'If-None-Match': '*' });
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toContain(
      'content-length;content-type;host;if-none-match',
    );
    const completePath = `${path}/${id}/complete`;

    await bystander.browser.post(completePath).expect(404);
    await admin.browser.post(completePath).expect(404);
    expect((await dev.browser.get(path).expect(200)).body.data.attachments).toEqual([]);

    send.mockResolvedValueOnce({ ContentLength: 41, ContentType: image.contentType });
    await dev.browser.post(completePath).expect(400);
    expect((await dev.browser.get(path).expect(200)).body.data.attachments).toEqual([]);

    send.mockResolvedValueOnce({
      ContentLength: 42,
      ContentType: image.contentType,
      ETag: '"test"',
    });
    send.mockResolvedValueOnce({});
    await dev.browser.post(completePath).expect(201);
    await dev.browser.post(completePath).expect(201);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[2]?.[0]).toMatchObject({
      input: { Key: `task-media/${id}`, CopySourceIfMatch: '"test"' },
    });
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(CopyObjectCommand);

    const list = await admin.browser.get(path).expect(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(list.body.data.attachments).toEqual([
      {
        id,
        ...image,
        url: expect.stringContaining(`https://media.example.test/task-media/${id}?`),
      },
    ]);

    await admin.browser.delete(`/api/v1/projects/${project}`).expect(204);
    expect((await admin.browser.get(path).expect(200)).body.data.uploadsEnabled).toBe(false);
    await dev.browser.post(path).send(image).expect(409);
  });
});
