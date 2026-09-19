import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AnalysisOwnershipService } from '../analyze/analysis-ownership.service';
import type { SafeUserDto } from '../auth/auth.types';
import { ClientProductEventsController } from './client-product-events.controller';
import { ProductEventsService } from './product-events.service';

const HASH = 'a'.repeat(64);
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const USER: SafeUserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'private@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('ClientProductEventsController', () => {
  let app: INestApplication<App>;
  const ownership = { hasOwnership: jest.fn().mockResolvedValue(true) };
  const events = {
    recordAnalysisOpened: jest.fn().mockResolvedValue(true),
    recordAnalysisSectionViewed: jest.fn().mockResolvedValue(true),
    recordAnalysisShared: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ownership.hasOwnership.mockResolvedValue(true);
    const moduleRef = await Test.createTestingModule({
      controllers: [ClientProductEventsController],
      providers: [
        { provide: AnalysisOwnershipService, useValue: ownership },
        { provide: ProductEventsService, useValue: events },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(
      (
        req: Request & { user?: SafeUserDto },
        _res: Response,
        next: NextFunction,
      ) => {
        req.user = USER;
        next();
      },
    );
    await app.init();
  });

  afterEach(() => app.close());

  test.each([
    ['analysis_opened', 'recordAnalysisOpened'],
    ['analysis_shared', 'recordAnalysisShared'],
  ] as const)('accepts the narrow %s contract', async (eventName, method) => {
    await request(app.getHttpServer())
      .post('/api/product-events/client')
      .send({ eventName, analysisHash: HASH, clientSessionId: SESSION_ID })
      .expect(202, { accepted: true });

    expect(ownership.hasOwnership).toHaveBeenCalledWith(USER.id, HASH);
    expect(events[method]).toHaveBeenCalledWith(USER.id, HASH, SESSION_ID);
  });

  test('accepts only allowlisted analysis sections', async () => {
    await request(app.getHttpServer())
      .post('/api/product-events/client')
      .send({
        eventName: 'analysis_section_viewed',
        analysisHash: HASH,
        clientSessionId: SESSION_ID,
        section: 'production',
      })
      .expect(202);
    expect(events.recordAnalysisSectionViewed).toHaveBeenCalledWith(
      USER.id,
      HASH,
      SESSION_ID,
      'production',
    );

    await request(app.getHttpServer())
      .post('/api/product-events/client')
      .send({
        eventName: 'analysis_section_viewed',
        analysisHash: HASH,
        clientSessionId: SESSION_ID,
        section: 'secret-internal-view',
      })
      .expect(400);
  });

  test.each([
    'analysis_upload_started',
    'analysis_upload_rejected',
    'analysis_completed',
    'analysis_failed',
    'shared_analysis_opened',
    'arbitrary_event',
  ])('rejects backend-only or unsupported event %s', async (eventName) => {
    await request(app.getHttpServer())
      .post('/api/product-events/client')
      .send({ eventName, analysisHash: HASH, clientSessionId: SESSION_ID })
      .expect(400);
    expect(ownership.hasOwnership).not.toHaveBeenCalled();
  });

  test.each([
    { userId: USER.id },
    { occurredAt: '1999-01-01T00:00:00.000Z' },
    { properties: { filename: 'private.hoi4' } },
    { arbitrary: 'value' },
  ])('rejects spoofed or arbitrary fields: %j', async (extra) => {
    await request(app.getHttpServer())
      .post('/api/product-events/client')
      .send({
        eventName: 'analysis_opened',
        analysisHash: HASH,
        clientSessionId: SESSION_ID,
        ...extra,
      })
      .expect(400);
    expect(events.recordAnalysisOpened).not.toHaveBeenCalled();
  });

  test('rejects an analysis the authenticated user does not own', async () => {
    ownership.hasOwnership.mockResolvedValue(false);
    await request(app.getHttpServer())
      .post('/api/product-events/client')
      .send({
        eventName: 'analysis_opened',
        analysisHash: HASH,
        clientSessionId: SESSION_ID,
      })
      .expect(404);
    expect(events.recordAnalysisOpened).not.toHaveBeenCalled();
  });

  test('requires a UUID browser session without accepting arbitrary identity', async () => {
    await request(app.getHttpServer())
      .post('/api/product-events/client')
      .send({
        eventName: 'analysis_opened',
        analysisHash: HASH,
        clientSessionId: 'fingerprint-or-user-agent',
      })
      .expect(400);
  });
});
