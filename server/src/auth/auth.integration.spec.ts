import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { applyMigrations } from '../database/migrations';
import { DuplicateEmailError, InvalidSessionError } from './auth.errors';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionRepository } from './session.repository';
import { SessionTokenService } from './session-token.service';
import { UserRepository } from './user.repository';

const connectionString = process.env.HOI4_TEST_DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase('PostgreSQL authentication integration', () => {
  let pool: Pool;
  let database: DatabaseService;
  let auth: AuthService;
  let tokens: SessionTokenService;

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
    database = new DatabaseService(
      { enabled: true, connectionString: connectionString as string },
      () => pool,
    );
    await database.onModuleInit();
    tokens = new SessionTokenService();
    auth = new AuthService(
      database,
      new UserRepository(database),
      new SessionRepository(database),
      new PasswordService(),
      tokens,
      3600,
    );
  });

  afterEach(async () => {
    await pool.query('TRUNCATE sessions, users CASCADE');
  });

  afterAll(async () => {
    await pool.query(
      'DROP TABLE IF EXISTS sessions, users, hoi4_schema_migrations CASCADE',
    );
    await database.onModuleDestroy();
  });

  test('registers, stores only password/token hashes, and authenticates', async () => {
    const plaintext = 'correct horse battery staple';
    const registered = await auth.register(' User@Example.COM ', plaintext);
    expect(registered.user.email).toBe('user@example.com');

    const storedUser = await pool.query<{
      email: string;
      password_hash: string;
    }>('SELECT email::text, password_hash FROM users');
    expect(storedUser.rows[0].email).toBe('user@example.com');
    expect(storedUser.rows[0].password_hash).toMatch(/^\$scrypt\$/);
    expect(storedUser.rows[0].password_hash).not.toBe(plaintext);

    const storedSession = await pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM sessions',
    );
    expect(storedSession.rows[0].token_hash).toBe(
      tokens.hash(registered.token),
    );
    expect(storedSession.rows[0].token_hash).not.toBe(registered.token);
    await expect(auth.authenticateSession(registered.token)).resolves.toEqual(
      registered.user,
    );
  });

  test('logs in against the persisted scrypt hash and creates another session', async () => {
    await auth.register('login@example.com', 'correct horse battery staple');
    const loggedIn = await auth.login(
      'LOGIN@example.com',
      'correct horse battery staple',
    );
    expect(loggedIn.user.email).toBe('login@example.com');
    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM sessions',
    );
    expect(count.rows[0].count).toBe('2');
  });

  test('maps the database case-insensitive uniqueness race to conflict', async () => {
    await auth.register('duplicate@example.com', 'valid password one');
    await expect(
      auth.register('DUPLICATE@example.com', 'valid password two'),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
    const counts = await pool.query<{ users: string; sessions: string }>(
      `SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM sessions) AS sessions`,
    );
    expect(counts.rows[0]).toEqual({ users: '1', sessions: '1' });
  });

  test('expired and revoked sessions cannot authenticate', async () => {
    const registered = await auth.register(
      'expiry@example.com',
      'correct horse battery staple',
    );
    await pool.query(
      "UPDATE sessions SET expires_at = now() - interval '1 second'",
    );
    await expect(
      auth.authenticateSession(registered.token),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect((await pool.query('SELECT id FROM sessions')).rowCount).toBe(0);

    const loggedIn = await auth.login(
      'expiry@example.com',
      'correct horse battery staple',
    );
    await auth.logout(loggedIn.token);
    await auth.logout(loggedIn.token);
    await expect(
      auth.authenticateSession(loggedIn.token),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  test('disabled users cannot use an existing session', async () => {
    const registered = await auth.register(
      'disabled@example.com',
      'correct horse battery staple',
    );
    await pool.query('UPDATE users SET disabled = true');
    await expect(
      auth.authenticateSession(registered.token),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  test('session token hashes remain unique and user deletion cascades sessions', async () => {
    const registered = await auth.register(
      'cascade@example.com',
      'correct horse battery staple',
    );
    const user = await pool.query<{ id: string }>('SELECT id FROM users');
    await expect(
      pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [user.rows[0].id, tokens.hash(registered.token)],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await pool.query('DELETE FROM users WHERE id = $1', [user.rows[0].id]);
    expect((await pool.query('SELECT id FROM sessions')).rowCount).toBe(0);
  });
});
