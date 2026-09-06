import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CampaignTrendsController } from './campaign-trends.controller';
import { CampaignTrendsService } from './campaign-trends.service';
import { UserAnalysesService } from './user-analyses.service';
import type { NextFunction, Request, Response } from 'express';
import type { SafeUserDto } from '../auth/auth.types';

describe('Campaign Trends API', () => {
  let app: INestApplication<App>;
  const build = jest.fn();
  const buildEquipment = jest.fn();
  const list = jest.fn().mockResolvedValue([]);
  const user: SafeUserDto = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'owner@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    build.mockReset();
    buildEquipment.mockReset();
    list.mockReset().mockResolvedValue([]);
    const module = await Test.createTestingModule({
      controllers: [CampaignTrendsController],
      providers: [
        {
          provide: CampaignTrendsService,
          useValue: { build, buildEquipment },
        },
        { provide: UserAnalysesService, useValue: { list } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (
        request: Request & { user?: SafeUserDto },
        _response: Response,
        next: NextFunction,
      ) => {
        request.user = user;
        next();
      },
    );
    await app.init();
  });

  afterEach(async () => app.close());

  test('returns the compact trends DTO', async () => {
    build.mockResolvedValue({ snapshotCount: 0, campaigns: [] });
    await request(app.getHttpServer())
      .get('/api/analyze/trends')
      .expect(HttpStatus.OK)
      .expect({ snapshotCount: 0, campaigns: [] });
    expect(build).toHaveBeenCalledWith([]);
  });

  test('returns a generic service error without leaking details', async () => {
    build.mockRejectedValue(new Error('C:/private/result.json.gz'));
    const response = await request(app.getHttpServer())
      .get('/api/analyze/trends')
      .expect(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.text).toContain('Could not load campaign trends');
    expect(response.text).not.toMatch(/private|result\.json/i);
  });

  test('returns compact equipment trends for an exact campaign and country', async () => {
    const dto = {
      campaignKey: 'campaign:0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      countryTag: 'GER',
      snapshotHashes: [],
      definitions: [],
    };
    buildEquipment.mockResolvedValue(dto);
    await request(app.getHttpServer())
      .get('/api/analyze/trends/equipment')
      .query({ campaignKey: dto.campaignKey, countryTag: 'GER' })
      .expect(HttpStatus.OK)
      .expect(dto);
    expect(buildEquipment).toHaveBeenCalledWith(dto.campaignKey, 'GER', []);
  });

  test('rejects malformed equipment trend identity without invoking the service', async () => {
    await request(app.getHttpServer())
      .get('/api/analyze/trends/equipment')
      .query({ campaignKey: 'campaign:guess', countryTag: 'Germany' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(buildEquipment).not.toHaveBeenCalled();
  });

  test('fails closed without invoking trends when ownership listing fails', async () => {
    list.mockRejectedValueOnce(new Error('database unavailable'));

    await request(app.getHttpServer())
      .get('/api/analyze/trends')
      .expect(HttpStatus.SERVICE_UNAVAILABLE);
    expect(build).not.toHaveBeenCalled();
  });
});
