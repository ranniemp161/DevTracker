import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { eq, taskAttachments, tasks } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, TEST_PROXY_SECRET, type TestApp } from './utils/test-app';

/** Attachments on the public request form (decision record 0022). The S3 client is stubbed. */
let t: TestApp;
type Send = (command: HeadObjectCommand | CopyObjectCommand | GetObjectCommand) => Promise<unknown>;
const client: { send: Send } = S3Client.prototype;

beforeAll(async () => {
  vi.stubEnv('R2_ACCOUNT_ID', 'test-account');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('R2_TASK_MEDIA_BUCKET', 'test-bucket');
  t = await createTestApp();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t?.close();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await t.reset();
});

type Fixture = Awaited<ReturnType<typeof projectFixture>>;

async function openForm(f: Fixture): Promise<string> {
  const res = await f.owner.browser
    .put(`/api/v1/projects/${f.project}/intake`)
    .send({ enabled: true })
    .expect(200);
  return res.body.data.intake.token;
}

const submit = (token: string, body: Record<string, unknown> = {}, ip = '203.0.113.1') =>
  t
    .http()
    .post(`/api/v1/public/requests/${token}`)
    .set('x-devtrack-client-ip', ip)
    .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
    .send({ kind: 'bug', title: 'Checkout button does nothing', ...body });

const complete = (token: string, id: string) =>
  t.http().post(`/api/v1/public/requests/${token}/attachments/${id}/complete`);

const png = { name: 'screen.png', contentType: 'image/png', size: 1200 };
const md = { name: 'steps.md', contentType: 'text/markdown', size: 300 };

/** Stubs R2: HEAD answers with the stored object, COPY succeeds. */
function storedAs(object: { ContentLength: number; ContentType: string }) {
  return vi.spyOn(client, 'send').mockImplementation(async (command) => {
    if (command instanceof HeadObjectCommand) return { ...object, ETag: '"etag"' };
    if (command instanceof CopyObjectCommand) return {};
    throw new Error('Unexpected storage request.');
  });
}

describe('request form attachments (0022)', () => {
  it('tells the form that uploads are available', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const info = await t.http().get(`/api/v1/public/requests/${token}`).expect(200);
    expect(info.body.data).toEqual({ projectName: expect.any(String), uploadsEnabled: true });
  });

  it('returns one upload per declared file and never the task key', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const res = await submit(token, { attachments: [png, md] }).expect(202);
    expect(res.body.data).toEqual({
      received: true,
      uploads: [
        { id: expect.any(String), url: expect.any(String), headers: expect.any(Object) },
        { id: expect.any(String), url: expect.any(String), headers: expect.any(Object) },
      ],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/DEV-\d/);
    const [upload] = res.body.data.uploads;
    expect(upload.headers).toEqual({ 'Content-Type': 'image/png', 'If-None-Match': '*' });
    expect(new URL(upload.url).pathname).toContain(`pending-task-media/${upload.id}`);

    const rows = await t.db.select().from(taskAttachments);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.uploaderId === null && r.completedAt === null)).toBe(true);
    // Without files nothing changes from 0016 except the empty list.
    const plain = await submit(token, { title: 'No files here' }).expect(202);
    expect(plain.body.data).toEqual({ received: true, uploads: [] });
  });

  it('refuses too many files, other types and files over the limits', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    await submit(token, { attachments: Array(6).fill(png) }).expect(400);
    await submit(token, { attachments: [{ ...png, contentType: 'image/svg+xml' }] }).expect(400);
    await submit(token, { attachments: [{ ...png, contentType: 'video/mp4' }] }).expect(400);
    await submit(token, { attachments: [{ ...png, size: 10 * 1024 * 1024 + 1 }] }).expect(400);
    await submit(token, { attachments: [{ ...md, size: 256 * 1024 + 1 }] }).expect(400);
    expect(await t.db.select().from(tasks)).toHaveLength(0);
  });

  it('returns no uploads for the honeypot', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const res = await submit(token, { website: 'spam', attachments: [png] }).expect(202);
    expect(res.body.data).toEqual({ received: true, uploads: [] });
    expect(await t.db.select().from(taskAttachments)).toHaveLength(0);
  });

  it('completes a matching upload once, and refuses a mismatch', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const res = await submit(token, { attachments: [png, md] }).expect(202);
    const [image, notes] = res.body.data.uploads;

    storedAs({ ContentLength: 999, ContentType: 'image/png' });
    await complete(token, image.id).expect(400);

    const send = storedAs({ ContentLength: 1200, ContentType: 'image/png' });
    await complete(token, image.id).expect(201);
    await complete(token, image.id).expect(201); // twice is harmless
    expect(send.mock.calls.filter(([c]) => c instanceof CopyObjectCommand)).toHaveLength(1);
    expect(send.mock.calls.find(([c]) => c instanceof CopyObjectCommand)?.[0]).toMatchObject({
      input: { Key: `task-media/${image.id}` },
    });

    const [row] = await t.db.select().from(taskAttachments).where(eq(taskAttachments.id, image.id));
    expect(row!.completedAt).not.toBeNull();
    const [other] = await t.db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.id, notes.id));
    expect(other!.completedAt).toBeNull();
  });

  it('only completes files sent through this form, by nobody on the team, within 15 minutes', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const res = await submit(token, { attachments: [png] }).expect(202);
    const [upload] = res.body.data.uploads;
    storedAs({ ContentLength: 1200, ContentType: 'image/png' });

    // Another form's token.
    const other = await f.owner.browser
      .post(`/api/v1/workspaces/${f.ws}/projects`)
      .send({ name: 'Other', key: 'OTH' })
      .expect(201);
    const otherToken = await openForm({ ...f, project: other.body.data.project.id });
    await complete(otherToken, upload.id).expect(404);

    // A file a team member is uploading to a task.
    const task = await f.dev.browser
      .post(`/api/v1/projects/${f.project}/tasks`)
      .send({ title: 'Internal' })
      .expect(201);
    const member = await f.dev.browser
      .post(`/api/v1/tasks/${task.body.data.task.id}/attachments`)
      .send(png)
      .expect(201);
    await complete(token, member.body.data.id).expect(404);

    // Too late.
    await t.db
      .update(taskAttachments)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(taskAttachments.id, upload.id));
    await complete(token, upload.id).expect(404);

    // Not a UUID.
    await complete(token, 'nope').expect(404);
  });

  it('limits declared files per IP', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    // 20 files per IP per hour: four requests of five use them up (submissions allow 5/hour).
    for (let i = 0; i < 4; i++)
      await submit(token, { attachments: Array(5).fill(png) }).expect(202);
    await submit(token, { attachments: [png] }).expect(429);
    // Another sender is unaffected.
    await submit(token, { attachments: [png] }, '203.0.113.9').expect(202);
  });

  it('shows completed files in Triage, with a signed link', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const res = await submit(token, { attachments: [png, md] }).expect(202);
    const [image] = res.body.data.uploads;
    storedAs({ ContentLength: 1200, ContentType: 'image/png' });
    await complete(token, image.id).expect(201);

    const list = await f.dev.browser.get(`/api/v1/projects/${f.project}/requests`).expect(200);
    expect(list.body.data[0].attachments).toEqual([
      { id: image.id, ...png, url: expect.stringContaining(`task-media/${image.id}`) },
    ]);
  });
});

describe('Markdown attachment content (0022 §5)', () => {
  it('returns the text of a completed Markdown file to people who can see the task', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const res = await submit(token, { attachments: [md, png] }).expect(202);
    const [notes, image] = res.body.data.uploads;
    vi.spyOn(client, 'send').mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        const isMd = command.input.Key?.endsWith(notes.id);
        return isMd
          ? { ContentLength: 300, ContentType: 'text/markdown', ETag: '"a"' }
          : { ContentLength: 1200, ContentType: 'image/png', ETag: '"b"' };
      }
      if (command instanceof CopyObjectCommand) return {};
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToString: async () => '# Steps\n\n1. Open checkout' } };
      }
      throw new Error('Unexpected storage request.');
    });
    await complete(token, notes.id).expect(201);
    await complete(token, image.id).expect(201);
    const [task] = await t.db.select().from(tasks);
    const path = (id: string) => `/api/v1/tasks/${task!.id}/attachments/${id}/content`;

    const ok = await f.dev.browser.get(path(notes.id)).expect(200);
    expect(ok.body.data).toEqual({ content: '# Steps\n\n1. Open checkout' });
    await f.bystander.browser.get(path(notes.id)).expect(404);
    await f.dev.browser.get(path(image.id)).expect(400);
  });
});
