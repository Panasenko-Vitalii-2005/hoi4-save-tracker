import { resolve } from 'node:path';
import { loadMigrations } from './migrations';

describe('database migrations', () => {
  test('loads deterministic, versioned, checksummed SQL migrations', async () => {
    const migrations = await loadMigrations(
      resolve(process.cwd(), 'migrations'),
    );

    expect(migrations).toHaveLength(2);
    expect(migrations[0]).toMatchObject({
      version: '0001',
      name: '0001_users_sessions.sql',
    });
    expect(migrations[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0].sql).toContain('CREATE TABLE users');
    expect(migrations[0].sql).toContain('CREATE TABLE sessions');
    expect(migrations[0].sql).not.toContain('AnalyzeResult');
    expect(migrations[1]).toMatchObject({
      version: '0002',
      name: '0002_analysis_ownership.sql',
    });
    expect(migrations[1].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[1].sql).toContain('CREATE TABLE analysis_ownership');
    expect(migrations[1].sql).toContain('PRIMARY KEY (user_id, analysis_hash)');
    expect(migrations[1].sql).not.toContain('AnalyzeResult');
  });
});
