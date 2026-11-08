import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppJwt, GithubAppClient } from './github-app.client';
import { testConfig, WEB_ORIGIN } from '../../test/utils/test-app';

describe('createAppJwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  it('signs an RS256 JWT GitHub accepts: backdated iat, exp within 10 minutes, iss = app ID', () => {
    const now = Date.UTC(2026, 10, 6, 12, 0, 0);
    const jwt = createAppJwt('12345', pem, now);
    const [header, payload, signature] = jwt.split('.');

    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(10 * 60);
    expect(claims.exp).toBeGreaterThan(now / 1000);

    const valid = verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature!, 'base64url'),
    );
    expect(valid).toBe(true);
  });
});

describe('GitHub user authorization API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paginates verified installations with a user token', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 101,
            installations: [{ id: 111, account: { login: 'agency', type: 'Organization' } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 101,
            installations: [
              {
                id: 222,
                account: { login: 'client', type: 'User' },
                suspended_at: '2026-11-08T00:00:00Z',
              },
            ],
          }),
        ),
      );
    vi.stubGlobal('fetch', request);
    const installations = await new GithubAppClient(testConfig()).listUserInstallations(
      'user-proof',
    );
    expect(installations.map((i) => i.id)).toEqual([111, 222]);
    expect(installations[1]!.suspendedAt).toEqual(new Date('2026-11-08T00:00:00Z'));
    expect(request).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/user/installations?per_page=100&page=2',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer user-proof' }),
      }),
    );
  });

  it('uses the user-scoped repository endpoint and rejects a failed verification', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 1,
            repositories: [
              {
                id: 1002,
                full_name: 'agency/site',
                owner: { login: 'agency' },
                private: true,
                default_branch: 'main',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', request);
    const client = new GithubAppClient(testConfig());
    expect((await client.listUserRepositories('user-proof', 111)).map((r) => r.id)).toEqual([1002]);
    expect(request).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/user/installations/111/repositories?per_page=100&page=1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer user-proof' }),
      }),
    );
    await expect(client.listUserRepositories('expired-proof', 111)).rejects.toMatchObject({
      code: 'GITHUB_API_ERROR',
    });
  });

  it('exchanges an authorization code with the same callback URI', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ access_token: 'short-lived-proof' })));
    vi.stubGlobal('fetch', request);
    const redirectUri = `${WEB_ORIGIN}/api/v1/github/install/callback`;
    expect(await new GithubAppClient(testConfig()).exchangeInstallCode('code', redirectUri)).toBe(
      'short-lived-proof',
    );
    expect(JSON.parse(request.mock.calls[0]![1].body)).toMatchObject({
      code: 'code',
      redirect_uri: redirectUri,
    });
  });
});
