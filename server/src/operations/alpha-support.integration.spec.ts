import { Pool } from 'pg';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from '../database/database.service';
import { loadMigrations } from '../database/migrations';
import { AuthService } from '../auth/auth.service';
import { UserRepository } from '../auth/user.repository';
import { SessionRepository } from '../auth/session.repository';
import { PasswordService } from '../auth/password.service';
import { SessionTokenService } from '../auth/session-token.service';
import { InvalidSessionError } from '../auth/auth.errors';
import { PersistedAnalysisResultService } from '../analyze/persisted-analysis-result.service';
import { SharedAnalysesService } from '../analyze/shared-analyses.service';
import { comparisonResult } from '../analyze/fixtures/analysis-comparison.fixture';
import {
  AlphaSupportService,
  purgeOldProductEvents,
} from './alpha-support.service';

const connectionString = process.env.HOI4_TEST_DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const H = 'a'.repeat(64);
const OTHER_H = 'b'.repeat(64);

describeDatabase('B3 isolated PostgreSQL account and privacy lifecycle', () => {
  let pool: Pool;
  let database: DatabaseService;
  let auth: AuthService;
  let directory: string;
  let shareFile: string;
  let results: PersistedAnalysisResultService;
  let shares: SharedAnalysesService;
  let support: AlphaSupportService;
  const original = [
    process.env.HOI4_SHARED_ANALYSES_FILE,
    process.env.HOI4_ANALYSIS_RESULTS_DIR,
  ];
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (
      !url.pathname.endsWith('_test') ||
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    )
      throw new Error('Requires an isolated local *_test database');
    pool = new Pool({ connectionString });
    await pool.query('CREATE SCHEMA alpha_support_b3');
    await pool.end();
    pool = new Pool({
      connectionString,
      options: '-c search_path=alpha_support_b3,public',
    });
    for (const migration of await loadMigrations())
      await pool.query(migration.sql);
    database = new DatabaseService(
      { enabled: true, connectionString: connectionString! },
      () => pool,
    );
    await database.onModuleInit();
    auth = new AuthService(
      database,
      new UserRepository(database),
      new SessionRepository(database),
      new PasswordService(),
      new SessionTokenService(),
      3600,
    );
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, analyses, product_events CASCADE');
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-b3-support-'));
    shareFile = join(directory, 'shares.json');
    process.env.HOI4_SHARED_ANALYSES_FILE = shareFile;
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    results = new PersistedAnalysisResultService();
    shares = new SharedAnalysesService(results, false);
    support = new AlphaSupportService(database, shares);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await files.rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await pool.query('DROP SCHEMA alpha_support_b3 CASCADE');
    await database.onModuleDestroy();
    ['HOI4_SHARED_ANALYSES_FILE', 'HOI4_ANALYSIS_RESULTS_DIR'].forEach(
      (name, index) => {
        if (original[index] === undefined) delete process.env[name];
        else process.env[name] = original[index];
      },
    );
  });
  const confirmation = (id: string) => ({
    apply: true,
    offlineConfirmed: true,
    confirmUser: id,
    verifiedCase: 'cohort-case-123',
  });
  const register = (name: string) =>
    auth.register(`${name}@example.invalid`, 'synthetic test password');
  async function own(id: string, hash = H) {
    await pool.query(
      'INSERT INTO analysis_ownership(user_id,analysis_hash,file_name,pinned) VALUES($1,$2,$3,true)',
      [id, hash, 'synthetic.hoi4'],
    );
    await results.save(hash, comparisonResult());
  }

  test('read-only preview retains legacy URL/store and session revocation invalidates every old token only for target', async () => {
    const a = await register('a');
    const a2 = await auth.login('a@example.invalid', 'synthetic test password');
    const b = await register('b');
    await own(a.user.id);
    const link = await shares.create(H);
    const before = await files.readFile(shareFile);
    const artifact = await files.readFile(
      join(directory, 'results', `${H}.json.gz`),
    );
    expect(await support.preview(a.user.id)).toMatchObject({
      found: true,
      sessions: 2,
      ownedAnalyses: 1,
      globalLinksToRevoke: 1,
    });
    expect(await files.readFile(shareFile)).toEqual(before);
    expect(
      await support.apply(
        'revoke-sessions',
        a.user.id,
        confirmation(a.user.id),
      ),
    ).toMatchObject({ revokedSessions: 2 });
    await expect(auth.authenticateSession(a.token)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    await expect(auth.authenticateSession(a2.token)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    await expect(auth.authenticateSession(b.token)).resolves.toEqual(b.user);
    expect(
      await files.readFile(join(directory, 'results', `${H}.json.gz`)),
    ).toEqual(artifact);
    await expect(
      new SharedAnalysesService(results, false).getResult(link!.id),
    ).resolves.not.toBeNull();
  });

  test('disable blocks old sessions and login, leaves owned data available for verified future support', async () => {
    const a = await register('a');
    await own(a.user.id);
    await support.apply('disable', a.user.id, confirmation(a.user.id));
    await expect(auth.authenticateSession(a.token)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    await expect(
      auth.login('a@example.invalid', 'synthetic test password'),
    ).rejects.toThrow();
    expect(await support.preview(a.user.id)).toMatchObject({
      disabled: true,
      sessions: 0,
      ownedAnalyses: 1,
    });
    expect(await results.exists(H)).toBe(true);
  });

  test('account deletion revokes global link first and removes sessions, ownership, account-linked events but not co-owner or artifact', async () => {
    const a = await register('a');
    const b = await register('b');
    await own(a.user.id);
    await own(b.user.id);
    await own(b.user.id, OTHER_H);
    const link = await shares.create(H);
    const unaffected = await shares.create(OTHER_H);
    await pool.query(
      "INSERT INTO analyses(content_hash,file_size_bytes,parse_duration_ms,division_count,save_format) VALUES($1,100,1,0,'plain_text')",
      [H],
    );
    for (const id of [a.user.id, b.user.id, null])
      await pool.query(
        "INSERT INTO product_events(event_name,user_id) VALUES('analysis_completed',$1)",
        [id],
      );
    expect(
      await support.apply('delete-account', a.user.id, confirmation(a.user.id)),
    ).toMatchObject({
      removedOwnerships: 1,
      removedAccountLinkedEvents: 1,
      physicalArtifactsErased: false,
      backupRecordsErased: false,
    });
    expect(await support.preview(a.user.id)).toEqual({ found: false });
    await expect(auth.authenticateSession(a.token)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
    await expect(auth.authenticateSession(b.token)).resolves.toEqual(b.user);
    expect(
      (
        await pool.query(
          'SELECT user_id FROM analysis_ownership WHERE analysis_hash=$1',
          [H],
        )
      ).rows,
    ).toEqual([{ user_id: b.user.id }]);
    expect((await pool.query('SELECT id FROM product_events')).rowCount).toBe(
      2,
    );
    expect((await pool.query('SELECT id FROM analyses')).rowCount).toBe(1);
    expect(await results.exists(H)).toBe(true);
    const restarted = new SharedAnalysesService(results, false);
    expect(await restarted.getResult(link!.id)).toBeNull();
    expect(await restarted.getResult(unaffected!.id)).not.toBeNull();
    expect((await restarted.create(H))!.id).not.toBe(link!.id);
  });

  test('share write failure fails safe: account disabled/sessions revoked but ownership/events not erased', async () => {
    const a = await register('a');
    await own(a.user.id);
    const link = await shares.create(H);
    await pool.query(
      "INSERT INTO product_events(event_name,user_id) VALUES('analysis_completed',$1)",
      [a.user.id],
    );
    const rename = files.rename;
    jest
      .spyOn(files, 'rename')
      .mockImplementation((from, to) =>
        to === shareFile
          ? Promise.reject(new Error('storage failure'))
          : rename(from, to),
      );
    await expect(
      support.apply('delete-account', a.user.id, confirmation(a.user.id)),
    ).rejects.toThrow();
    expect(await support.preview(a.user.id)).toMatchObject({
      disabled: true,
      sessions: 0,
      ownedAnalyses: 1,
      accountLinkedEvents: 1,
    });
    expect(await shares.getResult(link!.id)).not.toBeNull();
  });

  test('DB deletion failure rolls back account data, but already-revoked links stay revoked', async () => {
    const a = await register('a');
    await own(a.user.id);
    const link = await shares.create(H);
    await pool.query(
      "INSERT INTO product_events(event_name,user_id) VALUES('analysis_completed',$1)",
      [a.user.id],
    );
    const real = database.transaction.bind(database);
    let call = 0;
    jest.spyOn(database, 'transaction').mockImplementation((work) => {
      call += 1;
      if (call === 1) return real(work);
      return real(async (client) => {
        await work(client);
        throw new Error('synthetic commit failure');
      });
    });
    await expect(
      support.apply('delete-account', a.user.id, confirmation(a.user.id)),
    ).rejects.toThrow('synthetic commit failure');
    expect(await support.preview(a.user.id)).toMatchObject({
      disabled: true,
      sessions: 0,
      ownedAnalyses: 1,
      accountLinkedEvents: 1,
    });
    expect(await shares.getResult(link!.id)).toBeNull();
  });

  test('cohort tool refuses admin accounts and never treats email as verification', async () => {
    const a = await register('a');
    await pool.query('UPDATE users SET is_admin=true WHERE id=$1', [a.user.id]);
    await expect(
      support.apply('disable', a.user.id, confirmation(a.user.id)),
    ).rejects.toThrow('administrator');
    await expect(
      support.apply('disable', 'a@example.invalid', confirmation(a.user.id)),
    ).rejects.toThrow('UUID');
    await expect(auth.authenticateSession(a.token)).resolves.toEqual(a.user);
  });

  test('90-day purge removes only old raw events, preserving exact cutoff, recent events and canonical metadata', async () => {
    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    for (const time of [
      '2025-12-31T23:59:59.999Z',
      cutoff.toISOString(),
      '2026-01-02T00:00:00.000Z',
    ])
      await pool.query(
        "INSERT INTO product_events(event_name,occurred_at) VALUES('analysis_completed',$1)",
        [time],
      );
    await pool.query(
      "INSERT INTO analyses(content_hash,file_size_bytes,parse_duration_ms,division_count,save_format) VALUES($1,100,1,0,'plain_text')",
      [H],
    );
    jest
      .spyOn(database, 'query')
      .mockResolvedValueOnce({
        rows: [{ cutoff }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
    expect(await purgeOldProductEvents(database)).toEqual({
      retentionDays: 90,
      removed: 1,
      backlogRemaining: false,
    });
    expect((await pool.query('SELECT id FROM product_events')).rowCount).toBe(
      2,
    );
    expect((await pool.query('SELECT id FROM analyses')).rowCount).toBe(1);
    jest
      .spyOn(database, 'query')
      .mockResolvedValueOnce({
        rows: [{ cutoff }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });
    expect(await purgeOldProductEvents(database)).toMatchObject({
      removed: 0,
      backlogRemaining: false,
    });
  });
});
