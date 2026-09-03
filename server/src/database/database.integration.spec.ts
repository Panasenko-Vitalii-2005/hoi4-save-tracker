import { Pool } from 'pg';
import { applyMigrations, migrationStatus } from './migrations';

const connectionString = process.env.HOI4_TEST_DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase('PostgreSQL metadata schema', () => {
  let pool: Pool;

  beforeAll(async () => {
    const url = new URL(connectionString as string);
    if (!url.pathname.endsWith('_test')) {
      throw new Error('HOI4_TEST_DATABASE_URL must name a *_test database');
    }
    pool = new Pool({ connectionString });
    await pool.query(
      'DROP TABLE IF EXISTS sessions, users, hoi4_schema_migrations CASCADE',
    );
    await applyMigrations(pool);
  });

  afterEach(async () => {
    await pool.query('TRUNCATE sessions, users CASCADE');
  });

  afterAll(async () => {
    await pool.query(
      'DROP TABLE IF EXISTS sessions, users, hoi4_schema_migrations CASCADE',
    );
    await pool.end();
  });

  test('applies cleanly and is idempotent on an empty database', async () => {
    await expect(applyMigrations(pool)).resolves.toEqual([
      expect.objectContaining({ version: '0001', applied: true }),
    ]);
    await expect(migrationStatus(pool)).resolves.toEqual([
      expect.objectContaining({ version: '0001', applied: true }),
    ]);
  });

  test('creates the users and sessions schema', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('users', 'sessions')
       ORDER BY table_name`,
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      'sessions',
      'users',
    ]);
  });

  test('enforces case-insensitive unique email identity', async () => {
    await pool.query('INSERT INTO users (email) VALUES ($1)', [
      'User@example.com',
    ]);
    await expect(
      pool.query('INSERT INTO users (email) VALUES ($1)', ['user@example.com']),
    ).rejects.toMatchObject({ code: '23505' });
  });

  test('enforces session user FK and token-hash uniqueness', async () => {
    const user = await pool.query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      ['session@example.com'],
    );
    const values = [
      user.rows[0].id,
      'sha256-token-hash',
      new Date(Date.now() + 60_000),
    ];
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      values,
    );
    await expect(
      pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        values,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES (gen_random_uuid(), $1, $2)`,
        ['other-token-hash', new Date(Date.now() + 60_000)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  test('deletes sessions when their user is deleted', async () => {
    const user = await pool.query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      ['cascade@example.com'],
    );
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.rows[0].id, 'cascade-token-hash', new Date(Date.now() + 60_000)],
    );
    await pool.query('DELETE FROM users WHERE id = $1', [user.rows[0].id]);
    const sessions = await pool.query<{ count: string }>(
      'SELECT count(*) FROM sessions',
    );
    expect(sessions.rows[0].count).toBe('0');
  });
});
