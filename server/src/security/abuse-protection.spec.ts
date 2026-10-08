import {
  Body,
  Controller,
  Get,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import {
  InvalidCredentialsError,
  InvalidSessionError,
} from '../auth/auth.errors';
import { SESSION_COOKIE_SECURE } from '../auth/auth.config';
import { Public } from '../auth/route-access.decorator';
import { configureHttpSecurity } from '../http-security';
import {
  ABUSE_POLICIES,
  AbuseProtectionService,
  MAX_ABUSE_BUCKETS,
} from './abuse-protection.service';

const ORIGIN = 'https://cohort.example.invalid';
const TOKEN = 'c'.repeat(43);
const principal = (id: string) => ({
  id,
  email: 'isolated@example.invalid',
  createdAt: '2026-01-01T00:00:00Z',
});
let expensiveCalls = 0;
@Controller('api')
class ProtectedTestController {
  @Public() @Get('share/:id') share() {
    expensiveCalls++;
    return { public: true };
  }
  @Post('product-events/client') telemetry(@Body() body: unknown) {
    expensiveCalls++;
    return body;
  }
  @Post('analyze') upload() {
    expensiveCalls++;
    return { persisted: true };
  }
  @Post('analyze/batch/preflight') preflight() {
    return { knownHashes: [] };
  }
}

describe('alpha admission HTTP abuse boundary', () => {
  let app: INestApplication<App>;
  let now: number;
  let limits: AbuseProtectionService;
  const previous = { ...process.env };
  const auth = {
    authenticateSession: jest.fn((token: string) =>
      token.length === 43
        ? Promise.resolve(principal(token[0]))
        : Promise.reject(new InvalidSessionError()),
    ),
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
  };

  async function initialize(trusted = '') {
    process.env.HOI4_ABUSE_PROTECTION_ENABLED = 'true';
    process.env.HOI4_TRUSTED_PROXY_CIDRS = trusted;
    process.env.HOI4_CORS_ORIGIN = ORIGIN;
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [ProtectedTestController],
    })
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(SESSION_COOKIE_SECURE)
      .useValue(false)
      .compile();
    app = module.createNestApplication();
    configureHttpSecurity(app);
    await app.init();
    limits = module.get<AbuseProtectionService>(AbuseProtectionService);
  }
  beforeEach(async () => {
    now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    expensiveCalls = 0;
    jest.clearAllMocks();
    auth.login.mockRejectedValue(new InvalidCredentialsError());
    await initialize();
  });
  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
    process.env = { ...previous };
  });
  const post = (path: string, user = 'u') =>
    request(app.getHttpServer())
      .post(path)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', TOKEN)
      .set('Cookie', `hoi4_csrf=${TOKEN}; hoi4_session=${user.repeat(43)}`);
  const expectLimit = (response: {
    body: unknown;
    headers: Record<string, unknown>;
  }) => {
    expect(response.body).toMatchObject({
      code: 'RATE_LIMITED',
    });
    const body = response.body as { retryAfterSeconds: unknown };
    expect(typeof body.retryAfterSeconds).toBe('number');
    expect(Number(response.headers['retry-after'])).toBe(
      body.retryAfterSeconds,
    );
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.headers['cache-control']).toBe('no-store');
  };

  test('invalid login is limited by normalized account before password work; expires cleanly', async () => {
    for (let i = 0; i < 10; i++)
      await post('/api/auth/login')
        .send({ email: 'User@Example.com', password: 'wrong password' })
        .expect(401);
    expectLimit(
      await post('/api/auth/login')
        .send({ email: ' user@example.com ', password: 'wrong password' })
        .expect(429),
    );
    expect(auth.login).toHaveBeenCalledTimes(10);
    now += 900_001;
    auth.login.mockResolvedValue({
      user: principal('u'),
      token: 'u'.repeat(43),
      expiresAt: new Date(now + 3600_000),
    });
    await post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'valid password' })
      .expect(200);
  });
  test('20 legitimate users sharing one IP can each log in and retain valid sessions', async () => {
    auth.login.mockResolvedValue({
      user: principal('u'),
      token: 'u'.repeat(43),
      expiresAt: new Date(now + 3600_000),
    });
    for (let user = 0; user < 20; user++)
      await post('/api/auth/login')
        .send({
          email: `user${user}@example.invalid`,
          password: 'valid password',
        })
        .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', 'hoi4_session=' + 'u'.repeat(43))
      .expect(200);
  });
  test('IP middleware bounds invalid CSRF registration before auth, body parsing and writes', async () => {
    for (let i = 0; i < 40; i++)
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: `user${i}@example.invalid` })
        .expect(403);
    expectLimit(
      await request(app.getHttpServer())
        .post('/API/AUTH/REGISTER/')
        .set('Content-Type', 'application/json')
        .send('{broken')
        .expect(429),
    );
    expect(auth.register).not.toHaveBeenCalled();
  });
  test('public share floods include invalid IDs and header rotation cannot bypass untrusted socket identity', async () => {
    for (let i = 0; i < 60; i++)
      await request(app.getHttpServer())
        .get(`/api/share/invalid${i}`)
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .expect(200);
    expectLimit(
      await request(app.getHttpServer())
        .get('/api/share/another')
        .set('X-Forwarded-For', '198.51.100.1')
        .expect(429),
    );
    expect(expensiveCalls).toBe(60);
    now += 60_001;
    await request(app.getHttpServer()).get('/api/share/recovered').expect(200);
  });
  test('trusted immediate proxy uses rightmost untrusted client, not spoofed leftmost address', async () => {
    await app.close();
    await initialize('127.0.0.1/32,::1/128');
    for (let i = 0; i < 60; i++)
      await request(app.getHttpServer())
        .get('/api/share/test')
        .set('X-Forwarded-For', `203.0.113.${i}, 198.51.100.10`)
        .expect(200);
    await request(app.getHttpServer())
      .get('/api/share/test')
      .set('X-Forwarded-For', '203.0.113.200, 198.51.100.10')
      .expect(429);
    await request(app.getHttpServer())
      .get('/api/share/test')
      .set('X-Forwarded-For', '198.51.100.11')
      .expect(200);
  });
  test('telemetry is limited per authenticated user, with another NAT user still usable', async () => {
    for (let i = 0; i < 120; i++)
      await post('/api/product-events/client')
        .send({ event: 'test' })
        .expect(201);
    expectLimit(
      await post('/api/product-events/client')
        .send({ event: 'test' })
        .expect(429),
    );
    await post('/api/product-events/client', 'v')
      .send({ event: 'test' })
      .expect(201);
    expect(expensiveCalls).toBe(121);
  });
  test('upload user limit rejects before body/copy/worker/ownership interceptor work', async () => {
    for (let i = 0; i < 120; i++) await post('/api/analyze').expect(201);
    expectLimit(await post('/api/analyze').expect(429));
    expect(expensiveCalls).toBe(120);
    await post('/api/analyze', 'v').expect(201);
  });
  test('IP/global ceilings prevent rotating accounts from bypassing every upload control', async () => {
    for (let i = 0; i < 600; i++) {
      // IP middleware does not depend on a valid session or CSRF.
      await request(app.getHttpServer()).post('/api/analyze').expect(401);
    }
    expectLimit(await post('/api/analyze').expect(429));
    expect(expensiveCalls).toBe(0);
  });
  test('CSRF and session checks are not bypassed by rate-limit allowances', async () => {
    await request(app.getHttpServer()).post('/api/analyze').expect(401);
    await request(app.getHttpServer())
      .post('/api/analyze')
      .set('Cookie', 'hoi4_session=' + 'u'.repeat(43))
      .expect(403);
    expect(expensiveCalls).toBe(0);
    await post('/api/analyze').expect(201);
  });
  test('bounded hashed bucket storage fails closed rather than evicting live identities', () => {
    for (let i = 0; i < MAX_ABUSE_BUCKETS; i++)
      expect(limits.identityLimit('upload', `private-user-${i}`)).toBeNull();
    expect(limits.identityLimit('upload', 'overflow')).toBe(30);
    const storage = (limits as unknown as { buckets: Map<string, unknown> })
      .buckets;
    expect(storage.size).toBe(MAX_ABUSE_BUCKETS);
    expect([...storage.keys()].every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(
      true,
    );
    expect(JSON.stringify([...storage])).not.toContain('private-user');
    now += 3600_001;
    expect(limits.identityLimit('upload', 'overflow')).toBeNull();
  });
  test('global share ceiling bounds distributed client addresses', async () => {
    await app.close();
    await initialize('127.0.0.1/32,::1/128');
    for (let i = 0; i < ABUSE_POLICIES.share.global.count; i++)
      await request(app.getHttpServer())
        .get('/api/share/test')
        .set('X-Forwarded-For', `198.51.${Math.floor(i / 250)}.${i % 250}`)
        .expect(200);
    await request(app.getHttpServer())
      .get('/api/share/test')
      .set('X-Forwarded-For', '203.0.113.1')
      .expect(429);
  });
});
