import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { PullRequestPayload } from '../../src/github/webhooks/payloads';
import { signWebhookBody } from '../../src/github/webhooks/webhook-signature';
import { projectFixture } from './fixtures';
import { TEST_WEBHOOK_SECRET, type TestApp } from './test-app';

export const GH_INSTALLATION = 111;
export const GH_REPO = 1001;
export const REPO_NAME = 'acme-org/api';

/**
 * `projectFixture` plus a verified GitHub App installation (GitHub ID 111) whose repository
 * `acme-org/api` (GitHub ID 1001) is connected to project DEV.
 */
export async function githubFixture(t: TestApp) {
  const f = await projectFixture(t);
  t.githubApp.addInstallation(GH_INSTALLATION, 'acme-org', [
    {
      id: GH_REPO,
      fullName: REPO_NAME,
      ownerLogin: 'acme-org',
      defaultBranch: 'main',
      visibility: 'private',
    },
    {
      id: 1002,
      fullName: 'acme-org/web',
      ownerLogin: 'acme-org',
      defaultBranch: 'main',
      visibility: 'private',
    },
  ]);
  t.githubApp.codes.set('install-code', [GH_INSTALLATION]);
  const start = await f.owner.browser.get(`/api/v1/github/install?workspaceId=${f.ws}`).expect(302);
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  await f.owner.browser
    .get(
      `/api/v1/github/install/callback?installation_id=${GH_INSTALLATION}&setup_action=install&code=install-code&state=${state}`,
    )
    .expect(302);
  const list = await f.owner.browser.get(`/api/v1/github/installations?workspaceId=${f.ws}`);
  const installationId: string = list.body.data.installations[0].id;
  await f.owner.browser
    .put(`/api/v1/github/installations/${installationId}/repository-access`)
    .send({ githubRepositoryIds: [GH_REPO, 1002] })
    .expect(204);
  const connected = await f.owner.browser
    .post(`/api/v1/projects/${f.project}/repositories`)
    .send({ installationId, githubRepositoryId: GH_REPO });
  expect(connected.status).toBe(201);
  return { ...f, installationId, repositoryId: connected.body.data.repository.id as string };
}

/** Sends a signed webhook delivery, as GitHub would. */
export function deliver(
  t: TestApp,
  event: string,
  payload: unknown,
  options: { deliveryId?: string; secret?: string; signature?: string } = {},
) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return t
    .http()
    .post('/api/v1/webhooks/github')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', event)
    .set('X-GitHub-Delivery', options.deliveryId ?? randomUUID())
    .set(
      'X-Hub-Signature-256',
      options.signature ?? signWebhookBody(options.secret ?? TEST_WEBHOOK_SECRET, body),
    )
    .send(body);
}

export const sender = { id: 5001, login: 'octo', type: 'User' };
const repoRef = {
  installation: { id: GH_INSTALLATION },
  repository: { id: GH_REPO, full_name: REPO_NAME },
  sender,
};

export function pr(overrides: Record<string, unknown> = {}): PullRequestPayload {
  return {
    id: 7001,
    number: 12,
    title: 'Fix login',
    html_url: 'https://github.com/acme-org/api/pull/12',
    user: { login: 'octo' },
    head: { ref: 'feature/dev-1-login' },
    base: { ref: 'main' },
    state: 'open',
    draft: false,
    merged_at: null,
    closed_at: null,
    created_at: '2026-11-06T10:00:00Z',
    updated_at: '2026-11-06T10:00:00Z',
    ...overrides,
  } as PullRequestPayload;
}

export const pullRequestEvent = (action: string, prOverrides: Record<string, unknown> = {}) => ({
  ...repoRef,
  action,
  pull_request: pr(prOverrides),
});

export const commit = (n: number, message = `Commit ${n}`) => ({
  id: n.toString(16).padStart(40, '0'),
  message,
  timestamp: '2026-11-06T09:00:00Z',
  url: `https://github.com/acme-org/api/commit/${n.toString(16).padStart(40, '0')}`,
  author: { name: 'Octo Cat', username: 'octo' },
});

export const pushEvent = (commits: ReturnType<typeof commit>[], ref = 'refs/heads/main') => ({
  ...repoRef,
  ref,
  deleted: false,
  commits,
});

export const reviewEvent = (state = 'approved', reviewId = 8001) => ({
  ...repoRef,
  action: 'submitted',
  pull_request: pr(),
  review: {
    id: reviewId,
    user: { login: 'reviewer' },
    state,
    html_url: `https://github.com/acme-org/api/pull/12#pullrequestreview-${reviewId}`,
    submitted_at: '2026-11-06T11:00:00Z',
  },
});

export const releaseEvent = () => ({
  ...repoRef,
  action: 'published',
  release: {
    tag_name: 'v1.2.0',
    name: 'Spring release',
    html_url: 'https://github.com/acme-org/api/releases/tag/v1.2.0',
    prerelease: false,
  },
});
