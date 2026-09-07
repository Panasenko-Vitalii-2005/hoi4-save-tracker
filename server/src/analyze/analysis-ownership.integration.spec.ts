import { Pool } from 'pg';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../database/database.service';
import { applyMigrations } from '../database/migrations';
import { analyzeSave } from '../hoi4/hoi4-parser';
import { AnalysisOwnershipRepository } from './analysis-ownership.repository';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { SharedAnalysesService } from './shared-analyses.service';

const connectionString = process.env.HOI4_TEST_DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase('PostgreSQL analysis ownership integration', () => {
  let pool: Pool;
  let database: DatabaseService;
  let ownership: AnalysisOwnershipService;
  const hash = 'a'.repeat(64);

  beforeAll(async () => {
    const url = new URL(connectionString as string);
    if (!url.pathname.endsWith('_test'))
      throw new Error('HOI4_TEST_DATABASE_URL must name a *_test database');
    pool = new Pool({ connectionString });
    await pool.query(
      'DROP TABLE IF EXISTS analysis_ownership, sessions, users, hoi4_schema_migrations CASCADE',
    );
    await applyMigrations(pool);
    database = new DatabaseService(
      { enabled: true, connectionString: connectionString as string },
      () => pool,
    );
    await database.onModuleInit();
    ownership = new AnalysisOwnershipService(
      new AnalysisOwnershipRepository(database),
    );
  });

  afterEach(async () => {
    await pool.query('TRUNCATE analysis_ownership, sessions, users CASCADE');
  });

  afterAll(async () => {
    await pool.query(
      'DROP TABLE IF EXISTS analysis_ownership, sessions, users, hoi4_schema_migrations CASCADE',
    );
    await database.onModuleDestroy();
  });

  async function user(email: string): Promise<string> {
    const inserted = await pool.query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [email],
    );
    return inserted.rows[0].id;
  }

  test('same-user ensures are idempotent while the same hash may have multiple owners', async () => {
    const first = await user('first@example.com');
    const second = await user('second@example.com');

    await ownership.ensureOwnership(first, hash.toUpperCase());
    await ownership.ensureOwnership(first, hash);
    await ownership.ensureOwnership(second, hash);

    await expect(ownership.hasOwnership(first, hash)).resolves.toBe(true);
    await expect(ownership.hasOwnership(second, hash)).resolves.toBe(true);
    await expect(ownership.hasOwnership(first, 'b'.repeat(64))).resolves.toBe(
      false,
    );
    const stored = await pool.query<{
      user_id: string;
      analysis_hash: string;
    }>(
      `SELECT user_id, analysis_hash
       FROM analysis_ownership
       ORDER BY user_id`,
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.map((row) => row.analysis_hash)).toEqual([hash, hash]);
    await expect(ownership.listAllOwnedHashes()).resolves.toEqual(
      new Set([hash]),
    );
  });

  test('deleting a user cascades ownership without affecting another owner', async () => {
    const removed = await user('removed@example.com');
    const retained = await user('retained@example.com');
    await ownership.ensureOwnership(removed, hash);
    await ownership.ensureOwnership(retained, hash);

    await pool.query('DELETE FROM users WHERE id = $1', [removed]);

    await expect(ownership.hasOwnership(removed, hash)).resolves.toBe(false);
    await expect(ownership.hasOwnership(retained, hash)).resolves.toBe(true);
    await expect(ownership.listAllOwnedHashes()).resolves.toEqual(
      new Set([hash]),
    );
  });

  test('an existing hash has unknown ownership until an explicit relation is created', async () => {
    const owner = await user('legacy-check@example.com');

    await expect(ownership.hasOwnership(owner, hash)).resolves.toBe(false);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM analysis_ownership',
    );
    expect(count.rows[0].count).toBe('0');
  });

  test('keeps display metadata and pins private to each owner', async () => {
    const first = await user('first-metadata@example.com');
    const second = await user('second-metadata@example.com');
    await ownership.ensureOwnership(first, hash, {
      fileName: '../first.hoi4',
      analyzedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await ownership.ensureOwnership(second, hash, {
      fileName: 'second.hoi4',
      analyzedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await ownership.setPinned(first, hash, true);

    await expect(ownership.listForUser(first)).resolves.toEqual([
      {
        analysisHash: hash,
        pinned: true,
        fileName: 'first.hoi4',
        analyzedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await expect(ownership.listForUser(second)).resolves.toEqual([
      {
        analysisHash: hash,
        pinned: false,
        fileName: 'second.hoi4',
        analyzedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);
    await expect(ownership.pinnedHashes([hash])).resolves.toEqual(
      new Set([hash]),
    );

    await expect(ownership.remove(first, [hash])).resolves.toEqual([hash]);
    await expect(ownership.hasOwnership(first, hash)).resolves.toBe(false);
    await expect(ownership.hasOwnership(second, hash)).resolves.toBe(true);
  });

  test('physical retention follows the last owner and then a public share', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hoi4-owned-retention-'));
    const previousResults = process.env.HOI4_ANALYSIS_RESULTS_DIR;
    const previousShares = process.env.HOI4_SHARED_ANALYSES_FILE;
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
    try {
      const save = join(directory, 'fixture.hoi4');
      await writeFile(save, 'HOI4txt\ndate="1944.5.1.2"\ncountries={}');
      const result = analyzeSave(save);
      const first = await user('physical-first@example.com');
      const second = await user('physical-second@example.com');
      await ownership.ensureOwnership(first, hash);
      await ownership.ensureOwnership(second, hash);
      const results = new PersistedAnalysisResultService(ownership);
      const shares = new SharedAnalysesService(results);

      expect(await results.save(hash, result)).toBe(true);
      await ownership.remove(first, [hash]);
      await results.reconcile([]);
      expect(await results.get(hash)).toEqual(result);

      const link = await shares.create(hash);
      await ownership.remove(second, [hash]);
      const shared = await shares.protection();
      await results.reconcile(shared.references, {
        preserveUnknown: !shared.reliable,
      });
      expect(await shares.getResult(link!.id)).toEqual(result);

      await shares.revokeByHash(hash);
      await results.reconcile([]);
      expect(await results.exists(hash)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
      if (previousResults === undefined)
        delete process.env.HOI4_ANALYSIS_RESULTS_DIR;
      else process.env.HOI4_ANALYSIS_RESULTS_DIR = previousResults;
      if (previousShares === undefined)
        delete process.env.HOI4_SHARED_ANALYSES_FILE;
      else process.env.HOI4_SHARED_ANALYSES_FILE = previousShares;
    }
  });
});
