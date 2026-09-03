import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK = 1_204_104_004;

export interface Migration {
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationStatus extends Omit<Migration, 'sql'> {
  applied: boolean;
}

export function migrationsDirectory(): string {
  return resolve(process.cwd(), 'migrations');
}

export async function loadMigrations(
  directory = migrationsDirectory(),
): Promise<Migration[]> {
  const files = (await readdir(directory))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort((left, right) => left.localeCompare(right));

  const migrations = await Promise.all(
    files.map(async (name) => {
      const match = MIGRATION_FILE.exec(name);
      if (!match) throw new Error(`Invalid migration filename: ${name}`);
      const sql = await readFile(resolve(directory, name), 'utf8');
      return {
        version: match[1],
        name,
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql,
      };
    }),
  );

  if (
    new Set(migrations.map(({ version }) => version)).size !== migrations.length
  ) {
    throw new Error('Migration versions must be unique');
  }
  return migrations;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS hoi4_schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function withMigrationLock<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    return await operation(client);
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK])
      .catch(() => undefined);
    client.release();
  }
}

async function appliedMigrations(client: PoolClient) {
  return client.query<{
    version: string;
    name: string;
    checksum: string;
  }>('SELECT version, name, checksum FROM hoi4_schema_migrations');
}

function validateApplied(
  migrations: Migration[],
  rows: Array<{ version: string; name: string; checksum: string }>,
): Map<string, { version: string; name: string; checksum: string }> {
  const byVersion = new Map(rows.map((row) => [row.version, row]));
  for (const migration of migrations) {
    const existing = byVersion.get(migration.version);
    if (
      existing &&
      (existing.name !== migration.name ||
        existing.checksum !== migration.checksum)
    ) {
      throw new Error(`Applied migration ${migration.version} was modified`);
    }
  }
  return byVersion;
}

function toStatus(migration: Migration, applied: boolean): MigrationStatus {
  return {
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
    applied,
  };
}

export async function migrationStatus(
  pool: Pool,
  directory = migrationsDirectory(),
): Promise<MigrationStatus[]> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationTable(client);
    const migrations = await loadMigrations(directory);
    const applied = await appliedMigrations(client);
    const byVersion = validateApplied(migrations, applied.rows);
    return migrations.map((migration) =>
      toStatus(migration, byVersion.has(migration.version)),
    );
  });
}

export async function applyMigrations(
  pool: Pool,
  directory = migrationsDirectory(),
): Promise<MigrationStatus[]> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationTable(client);
    const migrations = await loadMigrations(directory);
    const applied = await appliedMigrations(client);
    const byVersion = validateApplied(migrations, applied.rows);

    for (const migration of migrations) {
      if (byVersion.has(migration.version)) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO hoi4_schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return migrations.map((migration) => toStatus(migration, true));
  });
}
