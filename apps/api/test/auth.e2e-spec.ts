import {
  emailVerificationTokens,
  eq,
  passwordResetTokens,
  sessions,
  users,
} from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/common/crypto/tokens';
import {
  cookieValue,
  createTestApp,
  registerUser,
  setCookies,
  VALID_PASSWORD,
  WEB_ORIGIN,
  type TestApp,
} from './utils/test-app';

const SESSION_COOKIE = 'devtrack_session';

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

async function verifiedBrowser(email = 'ada@example.com', username = 'ada') {
  const browser = t.browser();
  await registerUser(browser, { email, username });
  const token = t.mailer.lastToken(email, 'Verify');
  await browser.post('/api/v1/auth/verify-email').send({ token }).expect(200);
  return browser;
}

describe('registration', () => {
  it('creates an unverified user, starts a session and sends a verification email', async () => {
    const browser = t.browser();
    const res = await registerUser(browser, { email: '  Ada@Example.COM ', username: 'Ada' });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      email: 'ada@example.com',
      username: 'ada',
      emailVerified: false,
      avatarUrl: null,
    });
    expect(res.body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = setCookies(res).get(SESSION_COOKIE);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);

    expect(t.mailer.messages).toHaveLength(1);
    expect(t.mailer.messages[0]!.to).toBe('ada@example.com');

    const me = await browser.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.username).toBe('ada');
  });

  it('stores an Argon2id password hash and only a hash of the session token', async () => {
    const res = await registerUser(t.browser());
    const rawToken = cookieValue(setCookies(res).get(SESSION_COOKIE))!;

    const [user] = await t.db.select().from(users);
    expect(user!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    const rows = await t.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(rawToken));
    expect(rows[0]!.tokenHash).not.toContain(rawToken);
  });

  it('rejects a duplicate email or username with specific conflict codes', async () => {
    await registerUser(t.browser());
    const dupEmail = await registerUser(t.browser(), {
      email: 'ADA@example.com',
      username: 'other',
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe('EMAIL_TAKEN');

    const dupName = await registerUser(t.browser(), {
      email: 'other@example.com',
      username: 'ADA',
    });
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('returns field-level validation errors in the error envelope', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/register')
      .send({ email: 'nope', username: 'a', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.requestId).toBeTruthy();
    const paths = new Set(res.body.error.details.map((d: { path: string }) => d.path));
    expect([...paths].sort()).toEqual(['email', 'password', 'username']);
  });

  it('rejects malformed JSON without leaking parser internals', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('The request body is invalid.');
  });
});

describe('login and logout', () => {
  it('logs in with the correct password, case-insensitively by email', async () => {
    await registerUser(t.browser());
    const browser = t.browser();
    const res = await browser
      .post('/api/v1/auth/login')
      .send({ email: 'ADA@example.com', password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('ada@example.com');
    await browser.get('/api/v1/auth/me').expect(200);
  });

  it('gives the same response for a wrong password and an unknown email', async () => {
    await registerUser(t.browser());
    const wrong = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-password' });
    const unknown = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid email or password.');
      expect(setCookies(res).has(SESSION_COOKIE)).toBe(false);
    }
  });

  it('revokes the previous session of the same browser on login', async () => {
    const browser = t.browser();
    const reg = await registerUser(browser);
    const firstToken = cookieValue(setCookies(reg).get(SESSION_COOKIE))!;

    await browser
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD })
      .expect(200);

    const replay = await t
      .http()
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${firstToken}`);
    expect(replay.status).toBe(401);
    expect(await t.db.select().from(sessions)).toHaveLength(1);
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const browser = t.browser();
    const reg = await registerUser(browser);
    const token = cookieValue(setCookies(reg).get(SESSION_COOKIE))!;

    const out = await browser.post('/api/v1/auth/logout');
    expect(out.status).toBe(204);
    expect(setCookies(out).get(SESSION_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);

    await browser.get('/api/v1/auth/me').expect(401);
    const replay = await t
      .http()
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(replay.status).toBe(401);
    expect(await t.db.select().from(sessions)).toHaveLength(0);
  });

  it('rejects expired sessions', async () => {
    const browser = t.browser();
    await registerUser(browser);
    await t.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await browser.get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects requests without a session', async () => {
    const res = await t.http().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required.',
        requestId: expect.any(String),
      },
    });
  });
});

describe('email verification', () => {
  it('verifies the email with the emailed token, exactly once', async () => {
    const browser = t.browser();
    await registerUser(browser);
    const token = t.mailer.lastToken('ada@example.com', 'Verify');
    expect(t.mailer.messages[0]!.text).toContain(`${WEB_ORIGIN}/verify-email#token=`);

    const ok = await t.http().post('/api/v1/auth/verify-email').send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.emailVerified).toBe(true);

    const me = await browser.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.emailVerified).toBe(true);

    const replay = await t.http().post('/api/v1/auth/verify-email').send({ token });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_TOKEN');
  });

  it('stores only token hashes', async () => {
    await registerUser(t.browser());
    const token = t.mailer.lastToken('ada@example.com', 'Verify');
    const [row] = await t.db.select().from(emailVerificationTokens);
    expect(row!.tokenHash).toBe(hashToken(token));
  });

  it('rejects expired and unknown tokens', async () => {
    await registerUser(t.browser());
    const token = t.mailer.lastToken('ada@example.com', 'Verify');
    await t.db.update(emailVerificationTokens).set({ expiresAt: new Date(Date.now() - 1000) });

    const expired = await t.http().post('/api/v1/auth/verify-email').send({ token });
    expect(expired.body.error.code).toBe('INVALID_TOKEN');
    const unknown = await t
      .http()
      .post('/api/v1/auth/verify-email')
      .send({ token: 'x'.repeat(43) });
    expect(unknown.body.error.code).toBe('INVALID_TOKEN');
  });

  it('resend invalidates the previous link', async () => {
    const browser = t.browser();
    await registerUser(browser);
    const first = t.mailer.lastToken('ada@example.com', 'Verify');

    const resend = await browser.post('/api/v1/auth/resend-verification');
    expect(resend.status).toBe(202);
    const second = t.mailer.lastToken('ada@example.com', 'Verify');
    expect(second).not.toBe(first);

    expect((await t.http().post('/api/v1/auth/verify-email').send({ token: first })).status).toBe(
      400,
    );
    expect((await t.http().post('/api/v1/auth/verify-email').send({ token: second })).status).toBe(
      200,
    );

    const again = await browser.post('/api/v1/auth/resend-verification');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('blocks protected routes until the email is verified', async () => {
    const browser = t.browser();
    await registerUser(browser);

    const blocked = await browser.get('/api/v1/test-protected');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const token = t.mailer.lastToken('ada@example.com', 'Verify');
    await t.http().post('/api/v1/auth/verify-email').send({ token }).expect(200);

    const allowed = await browser.get('/api/v1/test-protected');
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.userId).toEqual(expect.any(String));
  });
});

describe('password reset', () => {
  it('responds identically for unknown emails and sends nothing', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ sent: true });
    expect(t.mailer.messages).toHaveLength(0);
  });

  it('resets the password, revokes every session, and is single-use', async () => {
    const browserA = await verifiedBrowser();
    const browserB = t.browser();
    await browserB
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD })
      .expect(200);

    const forgot = await t
      .http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ADA@example.com' });
    expect(forgot.status).toBe(202);
    const token = t.mailer.lastToken('ada@example.com', 'Reset');
    const [row] = await t.db.select().from(passwordResetTokens);
    expect(row!.tokenHash).toBe(hashToken(token));

    const newPassword = 'a brand new passphrase';
    const reset = await browserA
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword });
    expect(reset.status).toBe(200);
    expect(setCookies(reset).get(SESSION_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);

    await browserA.get('/api/v1/auth/me').expect(401);
    await browserB.get('/api/v1/auth/me').expect(401);
    expect(await t.db.select().from(sessions)).toHaveLength(0);

    const oldLogin = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });
    expect(oldLogin.status).toBe(401);
    await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: newPassword })
      .expect(200);

    const replay = await t
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'yet another passphrase' });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired reset token', async () => {
    await registerUser(t.browser());
    await t.http().post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' });
    const token = t.mailer.lastToken('ada@example.com', 'Reset');
    await t.db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await t
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a brand new passphrase' });
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('verifies the email as a side effect, since the link proves ownership', async () => {
    await registerUser(t.browser());
    await t.http().post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' });
    const token = t.mailer.lastToken('ada@example.com', 'Reset');
    await t
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a brand new passphrase' })
      .expect(200);
    const [user] = await t.db.select().from(users).where(eq(users.email, 'ada@example.com'));
    expect(user!.emailVerifiedAt).not.toBeNull();
  });
});

describe('rate limiting', () => {
  it('limits repeated login attempts for one email from one IP', async () => {
    await registerUser(t.browser());
    const attempt = () =>
      t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'wrong-password' });

    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Even the correct password is refused while limited.
    const correct = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });
    expect(correct.status).toBe(429);
  });

  it('limits password reset emails per address', async () => {
    await registerUser(t.browser());
    for (let i = 0; i < 3; i++) {
      await t
        .http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ada@example.com' })
        .expect(202);
    }
    const limited = await t
      .http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ada@example.com' });
    expect(limited.status).toBe(429);
  });
});

describe('CSRF origin check', () => {
  it('rejects state-changing requests from another origin', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects cross-site fetches that omit Origin', async () => {
    const res = await t.http().post('/api/v1/auth/logout').set('Sec-Fetch-Site', 'cross-site');
    expect(res.status).toBe(403);
  });

  it('allows the website origin', async () => {
    await registerUser(t.browser());
    const res = await t
      .http()
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'ada@example.com', password: VALID_PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe('platform behaviour', () => {
  it('serves health checks without authentication', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.body.data).toEqual({ status: 'ok' });
  });

  it('echoes a valid incoming request ID and replaces an invalid one', async () => {
    const id = '2f1d1f9e-4c1b-4a8e-9a43-0c3f6b8e2d11';
    const valid = await t.http().get('/api/v1/health').set('X-Request-Id', id);
    expect(valid.headers['x-request-id']).toBe(id);
    expect(valid.body.meta.requestId).toBe(id);

    const invalid = await t
      .http()
      .get('/api/v1/health')
      .set('X-Request-Id', '<script>forged</script>');
    expect(invalid.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 404 in the error envelope for unknown routes', async () => {
    const res = await t.http().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('secure cookie mode', () => {
  it('uses the __Host- prefix and Secure flag when served over HTTPS', async () => {
    const secure = await createTestApp({
      webOrigin: 'https://devtrack.example',
      secureCookies: true,
    });
    try {
      const res = await secure
        .http()
        .post('/api/v1/auth/register')
        .send({ email: 'ada@example.com', username: 'ada', password: VALID_PASSWORD });
      const cookie = setCookies(res).get('__Host-devtrack_session');
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/; Secure/);
      expect(cookie).not.toMatch(/Domain=/i);
    } finally {
      await secure.close();
    }
  });
});
