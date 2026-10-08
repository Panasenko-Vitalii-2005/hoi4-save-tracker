import { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { applyMigrations, loadMigrations } from '../database/migrations';
import { AnalysisOwnershipRepository } from './analysis-ownership.repository';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { SharedAnalysesService } from './shared-analyses.service';
import { UserAnalysesService } from './user-analyses.service';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import { historySummary } from './owned-analysis-history';

const connectionString = process.env.HOI4_TEST_DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase(
  'PostgreSQL owned-history migration and 500-snapshot cohort',
  () => {
    let pool: Pool;
    let database: DatabaseService;
    let directory: string;
    const envNames = [
      'HOI4_RECENT_ANALYSES_FILE',
      'HOI4_ANALYSIS_RESULTS_DIR',
      'HOI4_SHARED_ANALYSES_FILE',
      'HOI4_RECENT_ANALYSES_LIMIT',
    ];
    const previous = envNames.map((name) => process.env[name]);
    beforeAll(async () => {
      const url = new URL(connectionString!);
      if (!url.pathname.endsWith('_test'))
        throw new Error('Requires an isolated *_test database');
      pool = new Pool({ connectionString });
      // Separate schema so other opt-in integration suites cannot share/reset this fixture.
      await pool.query('CREATE SCHEMA owned_history_a1');
      await pool.end();
      pool = new Pool({
        connectionString,
        options: '-c search_path=owned_history_a1,public',
      });
      const migrations = await loadMigrations();
      for (const migration of migrations.filter(
        (entry) => entry.version < '0006',
      ))
        await pool.query(migration.sql);
      directory = await mkdtemp(join(tmpdir(), 'hoi4-pg-owned-history-'));
      process.env.HOI4_RECENT_ANALYSES_FILE = join(directory, 'recent.json');
      process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
      process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
      delete process.env.HOI4_RECENT_ANALYSES_LIMIT;
      database = new DatabaseService(
        { enabled: true, connectionString: connectionString! },
        () => pool,
      );
      await database.onModuleInit();
    });
    afterAll(async () => {
      await pool.query('DROP SCHEMA owned_history_a1 CASCADE');
      if (database) await database.onModuleDestroy();
      else await pool.end();
      if (directory) await rm(directory, { recursive: true, force: true });
      envNames.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
    });

    test('additive migration retains existing ownership and persists complete discovery beyond Recent across service restart', async () => {
      const existingUser = (
        await pool.query<{ id: string }>(
          "INSERT INTO users(email) VALUES ('existing@example.invalid') RETURNING id",
        )
      ).rows[0].id;
      const legacyHash = 'a'.repeat(64);
      await pool.query(
        'INSERT INTO analysis_ownership(user_id, analysis_hash, file_name, pinned) VALUES ($1,$2,$3,true)',
        [existingUser, legacyHash, 'before-migration.hoi4'],
      );
      const migration = (await loadMigrations()).find(
        (entry) => entry.version === '0006',
      )!;
      await pool.query(migration.sql);
      expect(
        (
          await pool.query(
            'SELECT pinned, history_metadata FROM analysis_ownership WHERE user_id=$1',
            [existingUser],
          )
        ).rows,
      ).toEqual([{ pinned: true, history_metadata: null }]);
      // Register already applied migration checksums, then prove ordinary migration execution is idempotent.
      await pool.query(
        'CREATE TABLE hoi4_schema_migrations(version text PRIMARY KEY, name text, checksum text, applied_at timestamptz DEFAULT now())',
      );
      for (const entry of await loadMigrations())
        await pool.query(
          'INSERT INTO hoi4_schema_migrations(version,name,checksum) VALUES($1,$2,$3)',
          [entry.version, entry.name, entry.checksum],
        );
      await expect(applyMigrations(pool)).resolves.toHaveLength(6);

      let ownership = new AnalysisOwnershipService(
        new AnalysisOwnershipRepository(database),
      );
      let results = new PersistedAnalysisResultService(ownership);
      let shares = new SharedAnalysesService(results);
      let recent = new RecentAnalysesService(results, shares);
      const ids: string[] = [];
      const firstHash = createHash('sha256').update('0:0').digest('hex');
      await pool.query(
        "INSERT INTO analyses(content_hash,file_size_bytes,parse_duration_ms,division_count,save_format) VALUES($1,1000,1,10,'plain_text')",
        [firstHash],
      );
      for (let user = 0; user < 20; user += 1) {
        const id = (
          await pool.query<{ id: string }>(
            'INSERT INTO users(email) VALUES($1) RETURNING id',
            [`cohort-${user}@example.invalid`],
          )
        ).rows[0].id;
        ids.push(id);
        for (let index = 0; index < 25; index += 1) {
          const hash = createHash('sha256')
            .update(`${user}:${index}`)
            .digest('hex');
          await recent.record(
            { hash, fileName: `${user}-${index}.hoi4`, fileSizeBytes: 1000 },
            comparisonResult({ game_date: `1944.1.${index + 1}` }),
            {
              campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
              gameVersion: '1.19.2',
            },
            async (item, fingerprint) =>
              ownership.ensureOwnership(id, hash, {
                fileName: item.fileName,
                ...(user !== 0
                  ? {
                      historyMetadata: {
                        version: 1,
                        summary: historySummary(item),
                        fingerprint: fingerprint!,
                      },
                    }
                  : {}),
              }),
          );
        }
      }
      expect(await recent.list()).toHaveLength(200);
      let users = new UserAnalysesService(ownership, recent, results, shares);
      for (const id of ids) expect(await users.list(id)).toHaveLength(25);
      expect(
        (await users.list(ids[0])).find((item) => item.hash === firstHash)
          ?.fileSizeBytes,
      ).toBe(1000);
      expect(
        (
          await pool.query<{ count: string }>(
            'SELECT count(*) FROM analysis_ownership WHERE history_metadata IS NOT NULL',
          )
        ).rows[0].count,
      ).toBe('500');
      ownership = new AnalysisOwnershipService(
        new AnalysisOwnershipRepository(database),
      );
      results = new PersistedAnalysisResultService(ownership);
      shares = new SharedAnalysesService(results);
      recent = new RecentAnalysesService(results, shares);
      users = new UserAnalysesService(ownership, recent, results, shares);
      const reads = jest.spyOn(results, 'getWithContext');
      for (const id of ids) {
        const items = await users.list(id);
        expect(items).toHaveLength(25);
        expect(items.every((item) => item.hasPersistedResult)).toBe(true);
      }
      expect(reads).not.toHaveBeenCalled();
      const [first] = await users.list(ids[0]);
      await expect(users.getResult(ids[1], first.hash)).resolves.toBeNull();
      await expect(users.delete(ids[0], first.hash)).resolves.toBe(true);
      expect(await users.list(ids[0])).toHaveLength(24);
      expect(
        await ownership.setHistoryMetadata(
          ids[0],
          first.hash,
          (await ownership.listForUser(ids[1]))[0].historyMetadata!,
        ),
      ).toBe(false);
      // An owner with >100 rows exercises the real indexed keyset loop (same-date ties).
      for (const id of ids.slice(1))
        await pool.query(
          'INSERT INTO analysis_ownership(user_id,analysis_hash,file_name,analyzed_at,history_metadata) SELECT $1,analysis_hash,file_name,$2::timestamptz,history_metadata FROM analysis_ownership WHERE user_id=$3 ON CONFLICT DO NOTHING',
          [existingUser, '2026-01-01 00:00:00.123456+00', id],
        );
      expect(await ownership.listForUser(existingUser)).toHaveLength(476);
      const index = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname='owned_history_a1' AND indexname='analysis_ownership_user_history_page_idx'",
      );
      expect(index.rows[0].indexdef).toContain(
        'user_id, analyzed_at DESC, analysis_hash',
      );
    }, 120000);
  },
);
