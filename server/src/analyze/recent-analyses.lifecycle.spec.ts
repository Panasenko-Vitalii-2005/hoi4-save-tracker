import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import {
  DATABASE_CONFIG,
  DATABASE_POOL_FACTORY,
  type DatabasePool,
  DatabaseService,
} from '../database/database.service';
import { AnalysisOwnershipRepository } from './analysis-ownership.repository';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';

const recentHash = 'a'.repeat(64);
const ownedHash = 'b'.repeat(64);
const result = comparisonResult();
const item = {
  hash: recentHash,
  fileName: 'fixture.hoi4',
  fileSizeBytes: 100,
  analyzedAt: '2026-01-01T00:00:00.000Z',
  gameDate: result.game_date,
  countryCount: result.active_countries,
  divisionCount: result.totals.divisions,
  shipCount: result.totals.ships,
  navalLossCount: result.navalLosses.length,
  manpowerInField: result.totals.manpowerInField,
  aircraftCount: result.totals.aircraft,
  hasPersistedResult: true,
  pinned: false,
  campaignId: null,
  playerCountryTag: null,
};

function queryResult(rows: QueryResultRow[] = []): QueryResult {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, rows, fields: [] };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Recent analyses startup lifecycle', () => {
  const envNames = [
    'HOI4_RECENT_ANALYSES_FILE',
    'HOI4_ANALYSIS_RESULTS_DIR',
    'HOI4_ANALYSIS_RESULTS_MAX_BYTES',
    'HOI4_RECENT_ANALYSES_LIMIT',
  ];
  const previous = envNames.map((key) => process.env[key]);
  let directory: string;
  let file: string;
  let app: INestApplication | undefined;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-recent-lifecycle-'));
    file = join(directory, 'recent.json');
    process.env.HOI4_RECENT_ANALYSES_FILE = file;
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    delete process.env.HOI4_RECENT_ANALYSES_LIMIT;
    const results = new PersistedAnalysisResultService();
    expect(await results.save(recentHash, result)).toBe(true);
    expect(await results.save(ownedHash, result)).toBe(true);
    await files.writeFile(file, JSON.stringify({ items: [item] }));
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    jest.restoreAllMocks();
    await files.rm(directory, { recursive: true, force: true });
    envNames.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  });

  async function application(query: (text: string) => Promise<QueryResult>) {
    const pool = {
      query: jest.fn(query),
      connect: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };
    // Keep both lifecycle providers in one module to test even concurrent
    // onModuleInit hooks, not an incidental imported-module ordering.
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: DATABASE_CONFIG,
          useValue: { enabled: true, connectionString: 'isolated-pool-double' },
        },
        {
          provide: DATABASE_POOL_FACTORY,
          useValue: () => pool as DatabasePool,
        },
        DatabaseService,
        AnalysisOwnershipRepository,
        AnalysisOwnershipService,
        PersistedAnalysisResultService,
        RecentAnalysesService,
      ],
    }).compile();
    app = module.createNestApplication();
    const recent = module.get(RecentAnalysesService);
    const ownership = jest.spyOn(
      module.get(AnalysisOwnershipService),
      'listAllOwnedHashes',
    );
    return { recent, ownership, database: module.get(DatabaseService), pool };
  }

  const ownedRows = () =>
    queryResult([{ analysisHash: recentHash }, { analysisHash: ownedHash }]);

  test('construction does not reconcile or access ownership before module initialization', async () => {
    const { recent, ownership, database, pool } = await application(() =>
      Promise.resolve(ownedRows()),
    );
    await recent['pending'];
    expect(database.available()).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
    expect(ownership).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test('bootstrap waits for database readiness and queues requests behind history initialization', async () => {
    const databaseEntered = deferred();
    const databaseReady = deferred();
    const reconciliationEntered = deferred();
    const reconciliationReady = deferred();
    const { recent, ownership, database } = await application(async (text) => {
      if (text === 'SELECT 1') {
        databaseEntered.resolve();
        await databaseReady.promise;
        return queryResult();
      }
      reconciliationEntered.resolve();
      await reconciliationReady.promise;
      return ownedRows();
    });
    let initialized = false;
    const initializing = app!.init().then(() => {
      initialized = true;
    });
    try {
      await databaseEntered.promise;
      await recent['pending'];
      expect(database.available()).toBe(false);
      expect(ownership).not.toHaveBeenCalled();
      expect(initialized).toBe(false);

      databaseReady.resolve();
      await reconciliationEntered.promise;
      expect(database.available()).toBe(true);
      expect(initialized).toBe(false);
      let recorded = false;
      const recording = recent
        .record(
          { hash: 'c'.repeat(64), fileName: 'new.hoi4', fileSizeBytes: 100 },
          result,
        )
        .then(() => {
          recorded = true;
        });
      await Promise.resolve();
      expect(recorded).toBe(false);

      reconciliationReady.resolve();
      await initializing;
      await recording;
      expect((await recent.list()).map(({ hash }) => hash)).toEqual([
        'c'.repeat(64),
        recentHash,
      ]);
      expect(await new PersistedAnalysisResultService().get(ownedHash)).toEqual(
        result,
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      databaseReady.resolve();
      reconciliationReady.resolve();
      await initializing;
    }
  });

  test('failed database initialization never starts reconciliation or rewrites history', async () => {
    const before = await files.readFile(file);
    const { ownership, pool } = await application(() =>
      Promise.reject(new Error('Isolated database unavailable')),
    );
    await expect(app!.init()).rejects.toThrow(
      'PostgreSQL connectivity validation failed',
    );
    expect(ownership).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(await files.readFile(file)).toEqual(before);
    expect(await new PersistedAnalysisResultService().get(ownedHash)).toEqual(
      result,
    );
  });

  test('transient ownership failure preserves artifacts and history across recovery and restart', async () => {
    const before = await files.readFile(file);
    process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES = '1';
    let unavailable = true;
    const query = (text: string) => {
      if (text === 'SELECT 1') return Promise.resolve(queryResult());
      return unavailable
        ? Promise.reject(new Error('Isolated ownership lookup failure'))
        : Promise.resolve(ownedRows());
    };
    const { recent } = await application(query);
    await app!.init();
    expect(await recent.list()).toEqual([item]);
    expect(await files.readFile(file)).toEqual(before);
    expect(await new PersistedAnalysisResultService().get(recentHash)).toEqual(
      result,
    );
    expect(await new PersistedAnalysisResultService().get(ownedHash)).toEqual(
      result,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('destructive artifact cleanup was skipped'),
    );

    unavailable = false;
    expect(await recent.list()).toEqual([item]);
    await app!.close();
    app = undefined;
    delete process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES;
    const restarted = await application(query);
    await app!.init();
    expect(await restarted.recent.list()).toEqual([item]);
    expect(await files.readFile(file)).toEqual(before);
    expect(await new PersistedAnalysisResultService().get(ownedHash)).toEqual(
      result,
    );
  });
});
