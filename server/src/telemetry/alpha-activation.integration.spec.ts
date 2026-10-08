import { Pool } from 'pg';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrations } from '../database/migrations';
import { DatabaseService } from '../database/database.service';
import { AnalysisOwnershipRepository } from '../analyze/analysis-ownership.repository';
import { AnalysisOwnershipService } from '../analyze/analysis-ownership.service';
import { PersistedAnalysisResultService } from '../analyze/persisted-analysis-result.service';
import { CampaignSnapshotProjectionCacheService } from '../analyze/campaign-snapshot-projection-cache.service';
import { comparisonResult } from '../analyze/fixtures/analysis-comparison.fixture';
import { summaryFromResult } from '../analyze/owned-analysis-history';
import { ProductEventsRepository } from './product-events.repository';
import { CampaignReviewService } from './campaign-review.service';
import {
  AlphaSupportService,
  purgeOldProductEvents,
} from '../operations/alpha-support.service';
import { SharedAnalysesService } from '../analyze/shared-analyses.service';
import { buildAlphaReport, type AlphaCohort } from './alpha-cohort-report';
const url = process.env.HOI4_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const H = 'a'.repeat(64),
  T = 'b'.repeat(64);
suite('C1 isolated PostgreSQL durable activation/review/retention', () => {
  let pool: Pool,
    database: DatabaseService,
    owners: AnalysisOwnershipService,
    events: ProductEventsRepository,
    results: PersistedAnalysisResultService,
    directory: string;
  const previous = [
    process.env.HOI4_ANALYSIS_RESULTS_DIR,
    process.env.HOI4_SHARED_ANALYSES_FILE,
  ];
  const context = {
    campaignId: '11111111-1111-4111-8111-111111111111',
    gameVersion: '1.19.2',
    playerCountryTag: 'GER',
  };
  const metadata = (hash = H) => ({
    contentHash: hash,
    fileSizeBytes: 100,
    parseDurationMs: 10,
    divisionCount: 1,
    saveFormat: 'plain_text' as const,
  });
  beforeAll(async () => {
    const location = new URL(url!);
    if (
      !location.pathname.endsWith('_test') ||
      !['127.0.0.1', 'localhost'].includes(location.hostname)
    )
      throw new Error('Isolated local *_test database required');
    pool = new Pool({ connectionString: url });
    await pool.query('CREATE SCHEMA alpha_activation_c1');
    await pool.end();
    pool = new Pool({
      connectionString: url,
      options: '-c search_path=alpha_activation_c1,public',
    });
    for (const migration of await loadMigrations())
      await pool.query(migration.sql);
    database = new DatabaseService(
      { enabled: true, connectionString: url! },
      () => pool,
    );
    await database.onModuleInit();
    owners = new AnalysisOwnershipService(
      new AnalysisOwnershipRepository(database),
    );
    events = new ProductEventsRepository(database);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users,analyses,product_events CASCADE');
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-c1-'));
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
    results = new PersistedAnalysisResultService();
  });
  afterEach(async () => {
    await files.rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await pool.query('DROP SCHEMA alpha_activation_c1 CASCADE');
    await database.onModuleDestroy();
    ['HOI4_ANALYSIS_RESULTS_DIR', 'HOI4_SHARED_ANALYSES_FILE'].forEach(
      (key, i) => {
        if (previous[i] === undefined) delete process.env[key];
        else process.env[key] = previous[i];
      },
    );
  });
  const user = async () =>
    (
      await pool.query<{ id: string }>(
        "INSERT INTO users(email) VALUES (gen_random_uuid()::text || '@example.invalid') RETURNING id",
      )
    ).rows[0].id;
  async function acquire(id: string, hash = H, gameDate = '1936.1.1') {
    const result = comparisonResult({ game_date: gameDate });
    await results.save(hash, result, [], { comparisonContext: context });
    await owners.ensureOwnership(id, hash, {
      fileName: 'synthetic.hoi4',
      historyMetadata: {
        version: 1,
        summary: summaryFromResult(result, 100, context)!,
        fingerprint: (await results.fingerprint(hash))!,
      },
    });
    await events.insertPersisted(id, metadata(hash));
  }
  test('first durable ownership is immutable across retry/dedup and two users can each acquire the same hash', async () => {
    const a = await user(),
      b = await user();
    await acquire(a);
    const first = (
      await pool.query<{ durable_acquired_at: Date }>(
        'SELECT durable_acquired_at FROM analysis_ownership WHERE user_id=$1',
        [a],
      )
    ).rows[0].durable_acquired_at;
    await acquire(a);
    await acquire(b);
    const acquired = (
      await pool.query<{ durable_acquired_at: Date }>(
        'SELECT durable_acquired_at FROM analysis_ownership WHERE user_id=$1',
        [a],
      )
    ).rows[0].durable_acquired_at;
    expect(acquired).toEqual(first);
    expect(
      (
        await pool.query<{ user_id: string; occurred_at: Date }>(
          "SELECT user_id,occurred_at FROM product_events WHERE event_name='analysis_persisted'",
        )
      ).rows,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: a, occurred_at: first }),
        expect.objectContaining({ user_id: b }),
      ]),
    );
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM product_events',
        )
      ).rows[0].count,
    ).toBe('2');
  });
  test('legacy ownership without confirmed durable commit is not backdated or counted as persistence', async () => {
    const a = await user();
    await owners.ensureOwnership(a, H);
    expect(await events.insertPersisted(a, metadata())).toBe(false);
    expect(
      (
        await pool.query<{ durable_acquired_at: Date | null }>(
          'SELECT durable_acquired_at FROM analysis_ownership',
        )
      ).rows[0].durable_acquired_at,
    ).toBeNull();
    expect(
      (await pool.query<{ count: string }>('SELECT count(*) FROM analyses'))
        .rows[0].count,
    ).toBe('0');
  });
  test('review eligibility and database dedup preserve ownership and reject forged references', async () => {
    const a = await user(),
      b = await user();
    await acquire(a, H);
    await acquire(a, T, '1936.2.1');
    const eligibility = new CampaignReviewService(
      owners,
      results,
      new CampaignSnapshotProjectionCacheService(results),
    );
    expect(await eligibility.eligible(a, H, T)).toBe(true);
    expect(await eligibility.eligible(b, H, T)).toBe(false);
    expect(await events.insertCampaignReview(a, H, T, a, 'trends')).toBe(true);
    expect(await events.insertCampaignReview(a, H, T, a, 'trends')).toBe(false);
    expect(await events.insertCampaignReview(a, H, T, a, 'compare')).toBe(true);
    expect(await events.insertCampaignReview(b, H, T, b, 'compare')).toBe(
      false,
    );
    const stored = (
      await pool.query<{ properties: Record<string, unknown> }>(
        "SELECT properties FROM product_events WHERE event_name='campaign_review_opened'",
      )
    ).rows;
    expect(
      stored.every(
        (r) =>
          Object.keys(r.properties).sort().join(',') ===
          'baseAnalysisId,viewKind',
      ),
    ).toBe(true);
    await owners.remove(a, [T]);
    expect(await eligibility.eligible(a, H, T)).toBe(false);
  });
  test('B3 account deletion removes new events/acquisition records but not co-owner data/artifacts', async () => {
    const a = await user(),
      b = await user();
    await acquire(a);
    await acquire(a, T, '1936.2.1');
    await acquire(b);
    await events.insertCampaignReview(a, H, T, a, 'intelligence');
    const support = new AlphaSupportService(
      database,
      new SharedAnalysesService(results, false),
    );
    await support.apply('delete-account', a, {
      apply: true,
      offlineConfirmed: true,
      confirmUser: a,
      verifiedCase: 'isolated-c1-case',
    });
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM product_events WHERE user_id=$1',
          [a],
        )
      ).rows[0].count,
    ).toBe('0');
    expect(await owners.hasOwnership(b, H)).toBe(true);
    expect(await results.exists(H)).toBe(true);
  });
  test('B3 retention removes aged new events; report derives durable state independently of a missing event mirror', async () => {
    const a = await user();
    await acquire(a);
    await acquire(a, T, '1936.2.1');
    await pool.query(
      "UPDATE product_events SET occurred_at=now()-interval '91 days'",
    );
    const outcome = await purgeOldProductEvents(database);
    expect(outcome.removed).toBe(2);
    const since = new Date(Date.now() - 60000).toISOString(),
      asOf = new Date(Date.now() + 1000).toISOString();
    const cohort: AlphaCohort = {
      startedAt: since,
      telemetryVerifiedSince: null,
      participants: Array.from({ length: 20 }, (_, i) => ({
        participantId: `p${i}`,
        role: 'tester',
        invitedAt: since,
        registration: i === 0 ? 'registered' : 'unregistered',
        userId: i === 0 ? a : null,
        usefulnessConfirmed: null,
        unpromptedReturnDates: [],
      })),
    };
    const report = await buildAlphaReport(
      database,
      results,
      new CampaignSnapshotProjectionCacheService(results),
      cohort,
      asOf,
    );
    expect(report.durableActivated).toBe(1);
    expect(report.campaignReady).toBe(1);
    expect(report.participants[0].firstReviewStatus).toBe('unavailable');
    expect(report.participants[0].persistenceFailures).toBeNull();
  });
});
