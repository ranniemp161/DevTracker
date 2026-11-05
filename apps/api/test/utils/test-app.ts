import { Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createTestDatabase } from '@devtrack/database/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  GithubOAuthClient,
  type ExchangeCodeParams,
  type GithubProfile,
} from '../../src/auth/github/github-oauth.client';
import { CurrentUser } from '../../src/common/decorators/auth.decorators';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config';
import { configureApp } from '../../src/configure-app';
import { DATABASE_CONNECTION } from '../../src/database/database.module';
import { MAILER, type Mailer, type MailMessage } from '../../src/mail/mailer';
import type { User } from '../../src/users/users.service';

export const WEB_ORIGIN = 'http://localhost:3000';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databaseUrl: 'pglite://in-memory',
    webOrigin: WEB_ORIGIN,
    trustProxy: false,
    secureCookies: false,
    github: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      callbackUrl: `${WEB_ORIGIN}/api/v1/auth/github/callback`,
    },
    mail: { transport: 'console', from: 'DevTrack <test@devtrack.local>' },
    ...overrides,
  };
}

/** Collects outgoing mail so tests can follow emailed links. */
export class CapturingMailer implements Mailer {
  messages: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }
  /** Token from the most recent email to `to` whose subject contains `subjectIncludes`. */
  lastToken(to: string, subjectIncludes: string): string {
    const msg = [...this.messages]
      .reverse()
      .find((m) => m.to === to && m.subject.includes(subjectIncludes));
    const token = msg?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`No "${subjectIncludes}" email with a token was sent to ${to}`);
    return token;
  }
}

/** Stands in for GitHub's OAuth endpoints. */
export class FakeGithubOAuthClient implements Pick<GithubOAuthClient, keyof GithubOAuthClient> {
  profile!: GithubProfile;
  email!: string | null;
  exchanges!: ExchangeCodeParams[];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.profile = {
      id: 9_000_001,
      login: 'Octo-Dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/9000001',
    };
    this.email = 'octo@example.com';
    this.exchanges = [];
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<string> {
    this.exchanges.push(params);
    return 'gho_fake_access_token';
  }
  async fetchProfile(): Promise<GithubProfile> {
    return this.profile;
  }
  async fetchPrimaryVerifiedEmail(): Promise<string | null> {
    return this.email;
  }
}

/** A route that uses the default (verified-email) protection, for guard tests. */
@Controller('test-protected')
class ProtectedTestController {
  @Get()
  get(@CurrentUser() user: User) {
    return { userId: user.id };
  }
  @Post()
  post() {
    return { ok: true };
  }
}

export async function createTestApp(overrides: Partial<AppConfig> = {}) {
  const config = testConfig(overrides);
  const database = await createTestDatabase();
  const mailer = new CapturingMailer();
  const github = new FakeGithubOAuthClient();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProtectedTestController],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(DATABASE_CONNECTION)
    .useValue({ db: database.db, close: database.close })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .overrideProvider(GithubOAuthClient)
    .useValue(github)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();

  return {
    app,
    config,
    db: database.db,
    mailer,
    github,
    http: () => request(app.getHttpServer()),
    /** A cookie-keeping client, i.e. one browser. */
    browser: () => request.agent(app.getHttpServer()),
    async reset() {
      await database.truncateAll();
      mailer.messages = [];
      github.reset();
    },
    close: () => app.close(),
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Parses `Set-Cookie` headers into name -> raw header line. */
export function setCookies(res: request.Response): Map<string, string> {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return new Map(list.map((line) => [line.slice(0, line.indexOf('=')), line]));
}

export function cookieValue(line: string | undefined): string | undefined {
  if (!line) return undefined;
  return decodeURIComponent(line.slice(line.indexOf('=') + 1).split(';')[0] ?? '');
}

export const VALID_PASSWORD = 'correct horse battery staple';

export async function registerUser(
  client: ReturnType<TestApp['browser']>,
  input: { email?: string; username?: string; password?: string } = {},
) {
  return client.post('/api/v1/auth/register').send({
    email: input.email ?? 'ada@example.com',
    username: input.username ?? 'ada',
    password: input.password ?? VALID_PASSWORD,
  });
}

/** Registers, verifies, and returns a signed-in browser for a new user. */
export async function verifiedUser(t: TestApp, username: string) {
  const email = `${username}@example.com`;
  const browser = t.browser();
  const res = await registerUser(browser, { email, username });
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status}`);
  const token = t.mailer.lastToken(email, 'Verify');
  await browser.post('/api/v1/auth/verify-email').send({ token }).expect(200);
  return { browser, email, username, id: res.body.data.user.id as string };
}
