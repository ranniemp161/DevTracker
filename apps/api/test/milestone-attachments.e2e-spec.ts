import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

type Command = HeadObjectCommand | CopyObjectCommand | GetObjectCommand | DeleteObjectCommand;

describe('milestone files (0030 §3)', () => {
  it('leads and admins add and remove files; members read them; outsiders get 404', async () => {
    const client: { send(command: Command): Promise<unknown> } = S3Client.prototype;
    const send = vi.spyOn(client, 'send').mockImplementation(async () => {
      throw new Error('Unexpected storage request.');
    });
    const { admin, dev, bystander, project } = await projectFixture(t);
    const milestone = (
      await admin.browser
        .post(`/api/v1/projects/${project}/milestones`)
        .send({ name: 'v1 Checkout' })
        .expect(201)
    ).body.data.milestone.id as string;
    const path = `/api/v1/milestones/${milestone}/attachments`;
    const spec = { name: 'spec.md', size: 42, contentType: 'text/markdown' };

    // Same types and limits as task attachments.
    await admin.browser
      .post(path)
      .send({ ...spec, contentType: 'image/svg+xml' })
      .expect(400);
    await admin.browser
      .post(path)
      .send({ ...spec, size: 50 * 1024 * 1024 + 1 })
      .expect(400);
    // Members read the brief but don't change it; outsiders don't see the milestone.
    await dev.browser.post(path).send(spec).expect(403);
    await bystander.browser.get(path).expect(404);
    await bystander.browser.post(path).send(spec).expect(404);

    const prepared = await admin.browser.post(path).send(spec).expect(201);
    const { id, headers } = prepared.body.data;
    expect(headers).toEqual({ 'Content-Type': 'text/markdown', 'If-None-Match': '*' });
    expect((await dev.browser.get(path).expect(200)).body.data).toEqual({
      attachments: [],
      uploadsEnabled: false,
    });

    send.mockResolvedValueOnce({ ContentLength: 42, ContentType: 'text/markdown', ETag: '"e"' });
    send.mockResolvedValueOnce({});
    await dev.browser.post(`${path}/${id}/complete`).expect(403);
    await admin.browser.post(`${path}/${id}/complete`).expect(201);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CopyObjectCommand);
    expect(send.mock.calls[1]?.[0]).toMatchObject({ input: { Key: `task-media/${id}` } });

    const list = await dev.browser.get(path).expect(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(list.body.data.attachments).toEqual([
      {
        id,
        ...spec,
        url: expect.stringContaining(`https://media.example.test/task-media/${id}?`),
      },
    ]);
    expect((await admin.browser.get(path).expect(200)).body.data.uploadsEnabled).toBe(true);

    // Markdown preview for everyone on the project.
    send.mockResolvedValueOnce({ Body: { transformToString: async () => '# Spec' } });
    expect((await dev.browser.get(`${path}/${id}/content`).expect(200)).body.data.content).toBe(
      '# Spec',
    );

    // Removing deletes the row and the stored object.
    await dev.browser.delete(`${path}/${id}`).expect(403);
    send.mockResolvedValueOnce({});
    await admin.browser.delete(`${path}/${id}`).expect(204);
    expect(send.mock.lastCall?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((await dev.browser.get(path).expect(200)).body.data.attachments).toEqual([]);
    await admin.browser.delete(`${path}/${id}`).expect(404);

    // Archived projects are read-only.
    await admin.browser.delete(`/api/v1/projects/${project}`).expect(204);
    expect((await admin.browser.get(path).expect(200)).body.data.uploadsEnabled).toBe(false);
    await admin.browser.post(path).send(spec).expect(409);
  });
});
