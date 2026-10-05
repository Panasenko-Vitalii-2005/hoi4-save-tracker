import {
  HttpException,
  HttpStatus,
  NotFoundException,
  type INestApplication,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { SessionGuard } from '../../auth/session.guard';
import type { AuthService } from '../../auth/auth.service';
import type { CsrfService } from '../../auth/csrf.service';
import { CampaignIntelligenceController } from './campaign-intelligence.controller';
import { CampaignIntelligenceService } from './campaign-intelligence.service';
import {
  intelligenceResult,
  intelligenceSnapshot,
  intelligenceWindow,
  query,
  hash,
} from './intelligence.fixture';
import { generateIntelligence } from './intelligence.engine';

describe('Campaign Intelligence read-only API', () => {
  let app: INestApplication<App>;
  const build = jest.fn();
  const authenticateSession = jest.fn();
  const validate = jest.fn();
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'owner@example.com',
    createdAt: '2026-01-01T00:00:00Z',
  };
  beforeEach(async () => {
    build.mockReset();
    authenticateSession.mockReset().mockResolvedValue(user);
    validate.mockReset();
    const module = await Test.createTestingModule({
      controllers: [CampaignIntelligenceController],
      providers: [
        { provide: CampaignIntelligenceService, useValue: { build } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(
      new SessionGuard(
        new Reflector(),
        { authenticateSession } as unknown as AuthService,
        { validate } as unknown as CsrfService,
      ),
    );
    await app.init();
  });
  afterEach(async () => app.close());
  const get = () =>
    request(app.getHttpServer())
      .get('/api/analyze/intelligence')
      .set('Cookie', 'hoi4_session=test-token');

  test('returns versioned structured evidence under the existing session guard', async () => {
    const data = generateIntelligence(
      [
        intelligenceSnapshot('a'),
        intelligenceSnapshot(
          'b',
          intelligenceResult({ mil: 12, allocation: 4 }),
          '1942.1.1',
        ),
      ],
      intelligenceWindow(),
    );
    build.mockResolvedValue(data);
    await get().query(query).expect(HttpStatus.OK).expect(data);
    expect(build).toHaveBeenCalledWith(user.id, query);
    expect(authenticateSession).toHaveBeenCalledWith('test-token');
    expect(validate).not.toHaveBeenCalled(); // Existing GET CSRF semantics.
  });
  test('unauthenticated request never reaches the engine', async () => {
    await request(app.getHttpServer())
      .get('/api/analyze/intelligence')
      .query(query)
      .expect(HttpStatus.UNAUTHORIZED);
    expect(build).not.toHaveBeenCalled();
  });
  test.each([
    { campaignKey: 'campaign:guess' },
    { campaignKey: `unknown:${hash('a')}` },
    { countryTag: 'Germany' },
    { baseHash: '../private' },
    { targetHash: '' },
    { countryTag: ['GER', 'SOV'] },
  ])('malformed/unknown query %j never reaches the engine', async (bad) => {
    await get()
      .query({ ...query, ...bad })
      .expect(HttpStatus.BAD_REQUEST);
    expect(build).not.toHaveBeenCalled();
  });
  test('unavailable/unauthorized endpoints return a generic 404', async () => {
    build.mockRejectedValue(
      new NotFoundException('Campaign snapshots are unavailable'),
    );
    await get().query(query).expect(HttpStatus.NOT_FOUND);
  });
  test('internal failures return a generic 503, never stack traces or paths', async () => {
    build.mockRejectedValue(new Error('C:/private/results/account.json.gz'));
    const response = await get()
      .query(query)
      .expect(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.text).toContain('Could not load campaign intelligence');
    expect(response.text).not.toMatch(/private|account|stack/i);
  });

  test('unexpected provider HTTP errors do not bypass generic error redaction', async () => {
    build.mockRejectedValue(
      new HttpException('C:/private/account.json.gz', 500),
    );
    const response = await get()
      .query(query)
      .expect(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.text).not.toMatch(/private|account/i);
  });
  test('same-day suppressed comparison is an ordinary structured response', async () => {
    const data = generateIntelligence(
      [intelligenceSnapshot('a'), intelligenceSnapshot('b')],
      {
        ...intelligenceWindow(),
        targetGameDate: '1941.1.1',
        temporalEligible: false,
        suppressionReasons: ['same_date_chronology_unknown'],
      },
    );
    build.mockResolvedValue(data);
    const response = await get().query(query).expect(HttpStatus.OK);
    expect((response.body as typeof data).insights).toEqual([]);
    expect((response.body as typeof data).window.suppressionReasons).toEqual([
      'same_date_chronology_unknown',
    ]);
  });
});
