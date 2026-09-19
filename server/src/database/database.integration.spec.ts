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
      'DROP TABLE IF EXISTS product_events, analyses, analysis_ownership, sessions, users, hoi4_schema_migrations CASCADE',
    );
    await applyMigrations(pool);
  });

  afterEach(async () => {
    await pool.query(
      'TRUNCATE product_events, analyses, sessions, users CASCADE',
    );
  });

  afterAll(async () => {
    await pool.query(
      'DROP TABLE IF EXISTS product_events, analyses, analysis_ownership, sessions, users, hoi4_schema_migrations CASCADE',
    );
    await pool.end();
  });

  test('applies cleanly and is idempotent on an empty database', async () => {
    await expect(applyMigrations(pool)).resolves.toEqual([
      expect.objectContaining({ version: '0001', applied: true }),
      expect.objectContaining({ version: '0002', applied: true }),
      expect.objectContaining({ version: '0003', applied: true }),
      expect.objectContaining({ version: '0004', applied: true }),
    ]);
    await expect(migrationStatus(pool)).resolves.toEqual([
      expect.objectContaining({ version: '0001', applied: true }),
      expect.objectContaining({ version: '0002', applied: true }),
      expect.objectContaining({ version: '0003', applied: true }),
      expect.objectContaining({ version: '0004', applied: true }),
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

  test('creates constrained analysis ownership metadata without artifact data', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'analysis_ownership'`,
    );
    expect(tables.rows).toEqual([{ table_name: 'analysis_ownership' }]);
    const columns = await pool.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'analysis_ownership'
         AND column_name IN ('pinned', 'file_name', 'analyzed_at')
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'analyzed_at', is_nullable: 'NO' },
      { column_name: 'file_name', is_nullable: 'YES' },
      { column_name: 'pinned', is_nullable: 'NO' },
    ]);
    const user = await pool.query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      ['owner@example.com'],
    );
    await pool.query(
      `INSERT INTO analysis_ownership (user_id, analysis_hash)
       VALUES ($1, $2)`,
      [user.rows[0].id, 'a'.repeat(64)],
    );
    await expect(
      pool.query(
        `INSERT INTO analysis_ownership (user_id, analysis_hash)
         VALUES ($1, $2)`,
        [user.rows[0].id, 'a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `INSERT INTO analysis_ownership (user_id, analysis_hash)
         VALUES ($1, $2)`,
        [user.rows[0].id, 'A'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO analysis_ownership (user_id, analysis_hash)
         VALUES (gen_random_uuid(), $1)`,
        ['b'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  test('creates constrained canonical analysis metadata and immutable events', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('analyses', 'product_events')
       ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'analyses',
      'product_events',
    ]);
    const user = await pool.query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      ['telemetry@example.com'],
    );
    const analysis = await pool.query<{ id: string }>(
      `INSERT INTO analyses
         (content_hash, file_size_bytes, parse_duration_ms,
          division_count, save_format)
       VALUES ($1, 100, 250, 12, 'plain_text')
       RETURNING id`,
      ['a'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO product_events
         (event_name, user_id, analysis_id, flow_id, properties)
       VALUES ('analysis_completed', $1, $2, $3, $4::jsonb)`,
      [
        user.rows[0].id,
        analysis.rows[0].id,
        '22222222-2222-4222-8222-222222222222',
        JSON.stringify({ totalDurationMs: 300 }),
      ],
    );
    await expect(
      pool.query(
        `INSERT INTO product_events (event_name, properties)
         VALUES ('arbitrary_event', '{}'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO product_events (event_name, properties)
         VALUES ('analysis_failed', '[]'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
