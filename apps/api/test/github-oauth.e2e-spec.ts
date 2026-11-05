import { accounts, oauthStates, users } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken, pkceChallenge } from '../src/common/crypto/tokens';
import {
  createTestApp,
  registerUser,
  setCookies,
  WEB_ORIGIN,
  type TestApp,
} from './utils/test-app';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

type Browser = ReturnType<TestApp['browser']>;

async function start(browser: Browser, redirectTo?: string) {
  const query = redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : '';
  const res = await browser.get(`/api/v1/auth/github${query}`);
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location as string);
  return { res, url, state: url.searchParams.get('state')! };
}

async function callback(browser: Browser, state: string, code = 'gh-code') {
  const res = await browser.get(
    `/api/v1/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
  expect(res.status).toBe(302);
  return { res, location: new URL(res.headers.location as string) };
}

describe('GitHub OAuth start', () => {
  it('redirects to GitHub with state, PKCE S256 and identity-only scopes', async () => {
    const { res, url, state } = await start(t.browser(), '/projects');

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(`${WEB_ORIGIN}/api/v1/auth/github/callback`);
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookie = setCookies(res).get('devtrack_oauth_state');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    // Only the state hash is stored; the challenge matches the stored verifier.
    const [row] = await t.db.select().from(oauthStates);
    expect(row!.stateHash).toBe(hashToken(state));
    expect(pkceChallenge(row!.codeVerifier)).toBe(url.searchParams.get('code_challenge'));
    expect(row!.redirectTo).toBe('/projects');
  });

  it('never stores an off-site redirect target', async () => {
    await start(t.browser(), 'https://evil.example/phish');
    const [row] = await t.db.select().from(oauthStates);
    expect(row!.redirectTo).toBe('/');
  });
});

describe('GitHub OAuth callback: state validation', () => {
  it('rejects a callback without the state cookie (login CSRF)', async () => {
    const { state } = await start(t.browser());
    const { location } = await callback(t.browser(), state); // different browser: no cookie
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('OAUTH_STATE_INVALID');
    expect(t.github.exchanges).toHaveLength(0);
  });

  it('rejects a state that does not match the cookie', async () => {
    const browser = t.browser();
    await start(browser);
    const { location } = await callback(browser, 'A'.repeat(43));
    expect(location.searchParams.get('error')).toBe('OAUTH_STATE_INVALID');
  });

  it('rejects an expired state', async () => {
    const browser = t.browser();
    const { state } = await start(browser);
    await t.db.update(oauthStates).set({ expiresAt: new Date(Date.now() - 1000) });
    const { location } = await callback(browser, state);
    expect(location.searchParams.get('error')).toBe('OAUTH_STATE_INVALID');
  });

  it('is single-use: replaying the same state fails', async () => {
    const browser = t.browser();
    const { state } = await start(browser);
    const first = await callback(browser, state);
    expect(first.location.pathname).toBe('/');

    // An attacker who captured both the callback URL and the cookie still cannot reuse them.
    const replay = await t
      .http()
      .get(`/api/v1/auth/github/callback?code=gh-code&state=${state}`)
      .set('Cookie', `devtrack_oauth_state=${state}`);
    expect(new URL(replay.headers.location as string).searchParams.get('error')).toBe(
      'OAUTH_STATE_INVALID',
    );
    expect(t.github.exchanges).toHaveLength(1);
  });

  it('reports a cancelled authorization as a provider error', async () => {
    const browser = t.browser();
    const { state } = await start(browser);
    const res = await browser.get(
      `/api/v1/auth/github/callback?error=access_denied&state=${state}`,
    );
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe(
      'OAUTH_PROVIDER_ERROR',
    );
  });
});

describe('GitHub OAuth callback: account resolution', () => {
  it('creates a verified account for a new GitHub user and signs them in', async () => {
    const browser = t.browser();
    const { state, url } = await start(browser, '/projects/abc');
    const { res, location } = await callback(browser, state);

    expect(location.origin).toBe(WEB_ORIGIN);
    expect(location.pathname).toBe('/projects/abc');
    expect(setCookies(res).has('devtrack_session')).toBe(true);

    // The PKCE verifier sent to GitHub matches the challenge in the authorize URL.
    expect(t.github.exchanges).toHaveLength(1);
    expect(pkceChallenge(t.github.exchanges[0]!.codeVerifier)).toBe(
      url.searchParams.get('code_challenge'),
    );

    const me = await browser.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user).toMatchObject({
      email: 'octo@example.com',
      username: 'octo-dev',
      emailVerified: true,
      avatarUrl: 'https://avatars.githubusercontent.com/u/9000001',
    });

    const [user] = await t.db.select().from(users);
    expect(user!.passwordHash).toBeNull();
    const [account] = await t.db.select().from(accounts);
    expect(account).toMatchObject({
      provider: 'github',
      providerAccountId: '9000001',
      userId: user!.id,
    });
  });

  it('signs a returning GitHub user into the same account', async () => {
    const first = t.browser();
    await callback(first, (await start(first)).state);
    t.github.email = 'changed-on-github@example.com'; // email changes do not matter once linked
    const second = t.browser();
    await callback(second, (await start(second)).state);

    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(await t.db.select().from(accounts)).toHaveLength(1);
  });

  it('links GitHub to an existing account only when that email is verified', async () => {
    const browser = t.browser();
    await registerUser(browser, { email: 'octo@example.com', username: 'octo' });
    const token = t.mailer.lastToken('octo@example.com', 'Verify');
    await t.http().post('/api/v1/auth/verify-email').send({ token }).expect(200);

    const gh = t.browser();
    await callback(gh, (await start(gh)).state);
    const me = await gh.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.username).toBe('octo');
    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(await t.db.select().from(accounts)).toHaveLength(1);
  });

  it('refuses to link to an unverified account (pre-hijacking protection)', async () => {
    await registerUser(t.browser(), { email: 'octo@example.com', username: 'squatter' });

    const gh = t.browser();
    const { location, res } = await callback(gh, (await start(gh)).state);
    expect(location.searchParams.get('error')).toBe('OAUTH_ACCOUNT_LINK_REQUIRED');
    expect(setCookies(res).has('devtrack_session')).toBe(false);
    expect(await t.db.select().from(accounts)).toHaveLength(0);
  });

  it('refuses GitHub accounts without a verified primary email', async () => {
    t.github.email = null;
    const gh = t.browser();
    const { location } = await callback(gh, (await start(gh)).state);
    expect(location.searchParams.get('error')).toBe('OAUTH_EMAIL_UNVERIFIED');
    expect(await t.db.select().from(users)).toHaveLength(0);
  });

  it('picks a free username when the GitHub login is taken', async () => {
    await registerUser(t.browser(), { email: 'someone@example.com', username: 'octo-dev' });
    const gh = t.browser();
    await callback(gh, (await start(gh)).state);
    const me = await gh.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.username).toBe('octo-dev-gh');
  });
});

describe('GitHub OAuth not configured', () => {
  it('redirects to login with OAUTH_NOT_CONFIGURED', async () => {
    const app = await createTestApp({ github: null });
    try {
      const res = await app.http().get('/api/v1/auth/github');
      expect(res.status).toBe(302);
      expect(new URL(res.headers.location as string).searchParams.get('error')).toBe(
        'OAUTH_NOT_CONFIGURED',
      );
    } finally {
      await app.close();
    }
  });
});
