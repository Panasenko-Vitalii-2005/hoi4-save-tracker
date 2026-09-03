import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CampaignTrendsController } from './campaign-trends.controller';
import { CampaignTrendsService } from './campaign-trends.service';

describe('Campaign Trends API', () => {
  let app: INestApplication<App>;
  const build = jest.fn();
  const buildEquipment = jest.fn();

  beforeEach(async () => {
    build.mockReset();
    buildEquipment.mockReset();
    const module = await Test.createTestingModule({
      controllers: [CampaignTrendsController],
      providers: [
        {
          provide: CampaignTrendsService,
          useValue: { build, buildEquipment },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  test('returns the compact trends DTO', async () => {
    build.mockResolvedValue({ snapshotCount: 0, campaigns: [] });
    await request(app.getHttpServer())
      .get('/api/analyze/trends')
      .expect(HttpStatus.OK)
      .expect({ snapshotCount: 0, campaigns: [] });
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
    expect(buildEquipment).toHaveBeenCalledWith(dto.campaignKey, 'GER');
  });

  test('rejects malformed equipment trend identity without invoking the service', async () => {
    await request(app.getHttpServer())
      .get('/api/analyze/trends/equipment')
      .query({ campaignKey: 'campaign:guess', countryTag: 'Germany' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(buildEquipment).not.toHaveBeenCalled();
  });
});
