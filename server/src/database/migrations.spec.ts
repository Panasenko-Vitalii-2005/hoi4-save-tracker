import { resolve } from 'node:path';
import { loadMigrations } from './migrations';

describe('database migrations', () => {
  test('loads deterministic, versioned, checksummed SQL migrations', async () => {
    const migrations = await loadMigrations(
      resolve(process.cwd(), 'migrations'),
    );

    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toMatchObject({
      version: '0001',
      name: '0001_users_sessions.sql',
    });
    expect(migrations[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0].sql).toContain('CREATE TABLE users');
    expect(migrations[0].sql).toContain('CREATE TABLE sessions');
    expect(migrations[0].sql).not.toContain('AnalyzeResult');
  });
});
