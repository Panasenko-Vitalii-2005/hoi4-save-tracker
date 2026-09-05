import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { applyMigrations } from '../database/migrations';
import { AnalysisOwnershipRepository } from './analysis-ownership.repository';
import { AnalysisOwnershipService } from './analysis-ownership.service';

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
  });

  test('deleting a user cascades ownership without affecting another owner', async () => {
    const removed = await user('removed@example.com');
    const retained = await user('retained@example.com');
    await ownership.ensureOwnership(removed, hash);
    await ownership.ensureOwnership(retained, hash);

    await pool.query('DELETE FROM users WHERE id = $1', [removed]);

    await expect(ownership.hasOwnership(removed, hash)).resolves.toBe(false);
    await expect(ownership.hasOwnership(retained, hash)).resolves.toBe(true);
  });

  test('an existing hash has unknown ownership until an explicit relation is created', async () => {
    const owner = await user('legacy-check@example.com');

    await expect(ownership.hasOwnership(owner, hash)).resolves.toBe(false);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM analysis_ownership',
    );
    expect(count.rows[0].count).toBe('0');
  });
});
