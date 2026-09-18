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
import { SharedAnalysesController } from '../analyze/shared-analyses.controller';
import { RecentAnalysesService } from '../analyze/recent-analyses.service';
import { AnalysisOwnershipService } from '../analyze/analysis-ownership.service';
import { SharedAnalysesService } from '../analyze/shared-analyses.service';
import { DatabaseService } from '../database/database.service';
import { configureHttpSecurity } from '../http-security';
import { HealthController } from '../records/records.controller';
import { SESSION_COOKIE_SECURE } from './auth.config';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import type { SafeUserDto } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { AuthUnavailableError, InvalidSessionError } from './auth.errors';
import {
  LocalSaveInput,
  LocalSaveRoute,
  Public,
} from './route-access.decorator';

const ORIGIN = 'https://tracker.example.com';
const SESSION_TOKEN = 'r'.repeat(43);
const SHARE_ID = 's'.repeat(22);
const USER: SafeUserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

@Controller('security-test')
class SecurityTestController {
  @Get('private')
  privateRoute(@CurrentUser() user: SafeUserDto) {
    return { user };
  }

  @Public()
  @Get('public')
  publicRoute() {
    return { public: true };
  }

  @Public()
  @Post('public-write')
  publicWrite() {
    return { accepted: true };
  }

  @LocalSaveRoute()
  @Get('local')
  localRoute() {
    return { local: true };
  }

  @LocalSaveInput()
  @Post('analysis')
  analysis(@Body() body: unknown) {
    return body;
  }
}

describe('HTTP session security boundary', () => {
  let app: INestApplication<App>;
  let database: { health: jest.Mock };
  let auth: {
    authenticateSession: jest.Mock;
    register: jest.Mock;
    login: jest.Mock;
    logout: jest.Mock;
  };
  const originalOrigin = process.env.HOI4_CORS_ORIGIN;
  const originalLocal = process.env.HOI4_LOCAL_SAVES_ENABLED;

  beforeAll(async () => {
    process.env.HOI4_CORS_ORIGIN = ORIGIN;
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'false';
    auth = {
      authenticateSession: jest.fn(),
      register: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
    };
    database = { health: jest.fn().mockResolvedValue('ok') };
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [
        SecurityTestController,
        HealthController,
        SharedAnalysesController,
      ],
      providers: [
        {
          provide: DatabaseService,
          useValue: database,
        },
        {
          provide: SharedAnalysesService,
          useValue: {
            getResult: jest.fn().mockResolvedValue({ game_date: '1944.5.1' }),
            create: jest.fn(),
          },
        },
        {
          provide: RecentAnalysesService,
          useValue: { revokeShare: jest.fn() },
        },
        {
          provide: AnalysisOwnershipService,
          useValue: { hasOwnership: jest.fn().mockResolvedValue(true) },
        },
      ],
    })
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(SESSION_COOKIE_SECURE)
      .useValue(false)
      .compile();
    app = moduleRef.createNestApplication();
    configureHttpSecurity(app);
    await app.init();
  });

  beforeEach(() => {
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'false';
    jest.clearAllMocks();
    database.health.mockResolvedValue('ok');
    auth.authenticateSession.mockImplementation((token: string) => {
      if (token === SESSION_TOKEN) return Promise.resolve(USER);
      return Promise.reject(new InvalidSessionError());
    });
    const result = {
      user: USER,
      token: SESSION_TOKEN,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    auth.register.mockResolvedValue(result);
    auth.login.mockResolvedValue(result);
    auth.logout.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
    if (originalOrigin === undefined) delete process.env.HOI4_CORS_ORIGIN;
    else process.env.HOI4_CORS_ORIGIN = originalOrigin;
    if (originalLocal === undefined)
      delete process.env.HOI4_LOCAL_SAVES_ENABLED;
    else process.env.HOI4_LOCAL_SAVES_ENABLED = originalLocal;
  });

  async function csrf() {
    const response = await request(app.getHttpServer())
      .get('/api/auth/csrf')
      .expect(200);
    const setCookies = response.headers['set-cookie'] as unknown as string[];
    return {
      token: (response.body as { csrfToken: string }).csrfToken,
      cookie: setCookies[0].split(';')[0],
      attributes: setCookies[0],
    };
  }

  function authenticatedCookie(csrfCookie?: string): string {
    return [csrfCookie, `hoi4_session=${SESSION_TOKEN}`]
      .filter(Boolean)
      .join('; ');
  }

  test('application routes are private by default and expose only a safe principal', async () => {
    await request(app.getHttpServer())
      .get('/security-test/private')
      .expect(401);
    const response = await request(app.getHttpServer())
      .get('/security-test/private')
      .set('Cookie', authenticatedCookie())
      .expect(200);
    expect(response.body).toEqual({ user: USER });
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|token|session|hash/i,
    );
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', authenticatedCookie())
      .expect(200);
    expect(me.body).toEqual({ user: USER });
    expect(me.headers['cache-control']).toBe('no-store');
  });

  test.each(['invalid', 'expired', 'revoked', 'disabled'])(
    '%s session is rejected',
    async () => {
      auth.authenticateSession.mockRejectedValueOnce(new InvalidSessionError());
      await request(app.getHttpServer())
        .get('/security-test/private')
        .set('Cookie', 'hoi4_session=i'.repeat(1) + 'i'.repeat(42))
        .expect(401);
    },
  );

  test('explicit public, readiness, health, and public-share read routes work anonymously', async () => {
    await request(app.getHttpServer())
      .get('/security-test/public')
      .expect(200)
      .expect({ public: true });
    await request(app.getHttpServer()).get('/api/health').expect(200);
    const readiness = await request(app.getHttpServer())
      .get('/api/readiness')
      .expect(200)
      .expect({ status: 'ok' });
    expect(readiness.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .get(`/api/share/${SHARE_ID}`)
      .expect(200)
      .expect({ game_date: '1944.5.1' });
  });

  test('readiness returns a generic 503 without leaking database failures', async () => {
    database.health.mockResolvedValueOnce('unavailable');
    const response = await request(app.getHttpServer())
      .get('/api/readiness')
      .expect(503);

    expect(response.body).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(response.body)).not.toMatch(
      /postgres|database|sql|host|port|credential|secret/i,
    );
  });

  test('CSRF bootstrap creates a readable, independent hardened cookie', async () => {
    const value = await csrf();
    expect(value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(value.token).not.toBe(SESSION_TOKEN);
    expect(value.attributes).toContain('Path=/');
    expect(value.attributes).toContain('SameSite=Lax');
    expect(value.attributes).not.toContain('HttpOnly');
    expect(value.attributes).not.toContain('Secure');
  });

  test('unsafe public and private requests require matching CSRF cookie/header', async () => {
    await request(app.getHttpServer())
      .post('/security-test/public-write')
      .expect(403);
    const value = await csrf();
    await request(app.getHttpServer())
      .post('/security-test/public-write')
      .set('Cookie', value.cookie)
      .set('X-CSRF-Token', 'w'.repeat(43))
      .expect(403);
    await request(app.getHttpServer())
      .post('/security-test/public-write')
      .set('Cookie', value.cookie)
      .set('X-CSRF-Token', value.token)
      .expect(201)
      .expect({ accepted: true });
    await request(app.getHttpServer())
      .post('/security-test/analysis')
      .set('Cookie', authenticatedCookie(value.cookie))
      .send({ upload: true })
      .expect(403);
    await request(app.getHttpServer())
      .post('/security-test/analysis')
      .set('Cookie', authenticatedCookie(value.cookie))
      .set('X-CSRF-Token', value.token)
      .send({ upload: true })
      .expect(201)
      .expect({ upload: true });
  });

  test('CSRF rejects an untrusted Origin even when token values match', async () => {
    const value = await csrf();
    const response = await request(app.getHttpServer())
      .post('/security-test/public-write')
      .set('Origin', 'https://evil.example')
      .set('Cookie', value.cookie)
      .set('X-CSRF-Token', value.token)
      .expect(403);
    expect(response.body).toMatchObject({ code: 'CSRF_INVALID' });
  });

  test('GET, HEAD and CORS OPTIONS are CSRF-exempt', async () => {
    await request(app.getHttpServer())
      .get('/security-test/private')
      .set('Cookie', authenticatedCookie())
      .expect(200);
    await request(app.getHttpServer())
      .head('/security-test/private')
      .set('Cookie', authenticatedCookie())
      .expect(200);
    const response = await request(app.getHttpServer())
      .options('/security-test/public-write')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type,X-CSRF-Token')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toBe(
      'Content-Type,X-CSRF-Token',
    );
  });

  test('credentialed CORS never emits a wildcard origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/security-test/public')
      .set('Origin', ORIGIN)
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  test('register and login are public but intentionally CSRF-protected', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: USER.email, password: 'valid password' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: USER.email, password: 'valid password' })
      .expect(403);

    const value = await csrf();
    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Cookie', value.cookie)
      .set('X-CSRF-Token', value.token)
      .send({ email: USER.email, password: 'valid password' })
      .expect(201);
    expect(registration.body).toEqual({ user: USER });
    const sessionCookie = (
      registration.headers['set-cookie'] as unknown as string[]
    ).find((cookie) => cookie.startsWith('hoi4_session='));
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Expires=');
    expect(sessionCookie).toContain('Max-Age=');
    expect(JSON.stringify(registration.body)).not.toContain(SESSION_TOKEN);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Cookie', value.cookie)
      .set('X-CSRF-Token', value.token)
      .send({ email: USER.email, password: 'valid password' })
      .expect(200);
  });

  test('logout revokes valid sessions, clears stale cookies, and remains idempotent', async () => {
    const value = await csrf();
    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', authenticatedCookie(value.cookie))
      .set('X-CSRF-Token', value.token)
      .expect(204);
    expect(auth.logout).toHaveBeenCalledWith(SESSION_TOKEN);
    const cleared = (response.headers['set-cookie'] as unknown as string[])[0];
    expect(cleared).toContain('hoi4_session=;');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('SameSite=Lax');

    auth.logout.mockClear();
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', value.cookie)
      .set('X-CSRF-Token', value.token)
      .expect(204);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  test('logout clears the browser cookie even when revocation storage fails', async () => {
    const value = await csrf();
    auth.logout.mockRejectedValueOnce(new AuthUnavailableError());
    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', authenticatedCookie(value.cookie))
      .set('X-CSRF-Token', value.token)
      .expect(503);
    expect(
      (response.headers['set-cookie'] as unknown as string[])[0],
    ).toContain('hoi4_session=;');
    expect(JSON.stringify(response.body)).not.toMatch(/database|postgres|sql/i);
  });

  test('local-disabled routes return 404 before authentication and CSRF', async () => {
    await request(app.getHttpServer()).get('/security-test/local').expect(404);
    await request(app.getHttpServer())
      .post('/security-test/analysis')
      .send({ path: 'private-save.hoi4' })
      .expect(404);
  });

  test('local-enabled routes follow the authenticated application policy', async () => {
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'true';
    await request(app.getHttpServer()).get('/security-test/local').expect(401);
    await request(app.getHttpServer())
      .get('/security-test/local')
      .set('Cookie', authenticatedCookie())
      .expect(200)
      .expect({ local: true });
  });
});
