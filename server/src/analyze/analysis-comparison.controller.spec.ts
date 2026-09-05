import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as parser from '../hoi4/hoi4-parser';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { AnalyzeController } from './analyze.controller';
import { AnalysisComparisonService } from './analysis-comparison.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import type { AnalysisComparisonDto } from './analysis-comparison.types';
import { SaveUploadInterceptor } from './save-upload.interceptor';
import { AnalysisOwnershipService } from './analysis-ownership.service';

describe('Compare persisted analyses API', () => {
  let app: INestApplication<App>;
  let directory: string;
  let results: PersistedAnalysisResultService;
  const previous = process.env.HOI4_ANALYSIS_RESULTS_DIR;
  const base = 'a'.repeat(64);
  const target = 'b'.repeat(64);
  const comparisonContext = {
    campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
    gameVersion: '1.19.2',
  };
  const analyze = jest.fn();
  const start = async () => {
    const module = await Test.createTestingModule({
      controllers: [AnalyzeController],
      providers: [
        AnalysisComparisonService,
        SaveUploadInterceptor,
        PersistedAnalysisResultService,
        {
          provide: AnalysisResultCacheService,
          useValue: { analyzeWithHash: analyze },
        },
        { provide: RecentAnalysesService, useValue: {} },
        {
          provide: AnalysisOwnershipService,
          useValue: { ensureOwnership: jest.fn() },
        },
      ],
    }).compile();
    results = module.get(PersistedAnalysisResultService);
    app = module.createNestApplication();
    await app.init();
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hoi4-compare-'));
    process.env.HOI4_ANALYSIS_RESULTS_DIR = directory;
    analyze.mockClear();
    jest.spyOn(parser, 'analyzeSave');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await start();
    await results.save(
      base,
      comparisonResult({
        stockpileSummaries: [
          {
            countryTag: 'GER',
            definitions: [
              { definition: 'infantry_equipment_2', amount: 1.5, variants: [] },
            ],
            unresolvedVariants: [],
          },
        ],
      }),
      [],
      { comparisonContext },
    );
    const next = comparisonResult({
      game_date: '1944.6.1',
      stockpileSummaries: [
        {
          countryTag: 'GER',
          definitions: [
            { definition: 'infantry_equipment_2', amount: 4, variants: [] },
          ],
          unresolvedVariants: [],
        },
      ],
    });
    next.totals.divisions = 15;
    await results.save(target, next, [], { comparisonContext });
  });
  afterEach(async () => {
    expect(analyze).not.toHaveBeenCalled(); // No cache or Worker dependency is used.
    expect(parser.analyzeSave).not.toHaveBeenCalled();
    jest.restoreAllMocks();
    await app.close();
    await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HOI4_ANALYSIS_RESULTS_DIR;
    else process.env.HOI4_ANALYSIS_RESULTS_DIR = previous;
  });
  const get = (left = base, right = target) =>
    request(app.getHttpServer())
      .get('/api/analyze/compare')
      .query({ base: left, target: right });

  test('returns compact comparison and works after restart without the RAM cache', async () => {
    const before = await get().expect(200);
    const body = before.body as AnalysisComparisonDto;
    expect(body.summary.divisions).toEqual({
      before: 10,
      after: 15,
      delta: 5,
    });
    expect(body.baseGameDate).toBe('1944.5.1');
    expect(body.targetGameDate).toBe('1944.6.1');
    expect(body.equipmentProduction[0].definitions[0].stockpile).toEqual({
      presence: 'both',
      balance: { before: 1.5, after: 4, delta: 2.5 },
    });
    expect(body.context).toEqual({
      chronology: 'target_after_base',
      sameAnalysis: false,
      campaignCompatibility: 'same',
      gameVersionCompatibility: 'same',
    });
    expect(before.text).not.toMatch(
      /by_country|equipment_by_country|divisionTemplateCatalog|savedAt|formatVersion|parse_seconds|lineRef|equipmentRef|variants|progressFraction|activeEfficiency/,
    );
    expect(before.text).not.toContain(directory);
    await app.close();
    await start();
    expect((await get().expect(200)).body).toEqual(before.body);
  });

  test('same hash accepted and loaded only once, with zero differences', async () => {
    const read = jest.spyOn(results, 'getWithContext');
    const response = await get(base.toUpperCase(), base).expect(200);
    const body = response.body as AnalysisComparisonDto;
    expect(body.baseHash).toBe(base);
    expect(body.context.sameAnalysis).toBe(true);
    expect(body.context.chronology).toBe('same_date');
    expect(body.hasChanges).toBe(false);
    expect(body.summary.divisions.delta).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['bad', target],
    [base, '../secret'],
    ['', target],
    [base, 'a'.repeat(63)],
  ])('invalid hashes %s / %s rejected', async (left, right) => {
    await get(left, right).expect(400);
  });
  test('missing or repeated query fields are safely rejected', async () => {
    await request(app.getHttpServer()).get('/api/analyze/compare').expect(400);
    await request(app.getHttpServer())
      .get(`/api/analyze/compare?base=${base}&base=${target}&target=${target}`)
      .expect(400);
  });
  test.each([base, target])(
    'missing persisted result %s is a safe 404',
    async (hash) => {
      await results.delete(hash);
      const response = await get().expect(404);
      expect(response.text).not.toMatch(/ENOENT|json.gz|stack/);
      expect(response.text).not.toContain(directory);
    },
  );
  test('corrupt persisted data uses existing safe unavailable handling', async () => {
    await writeFile(join(directory, `${target}.json.gz`), 'corrupt gzip');
    const response = await get().expect(404);
    expect(response.text).not.toMatch(/gzip|stack/);
  });
  test('unexpected storage failure is generic, without paths', async () => {
    jest
      .spyOn(results, 'getWithContext')
      .mockRejectedValue(new Error('C:/private/error'));
    const response = await get().expect(503);
    expect(response.text).not.toContain('private');
  });
});
