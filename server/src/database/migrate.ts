import { Pool } from 'pg';
import { applyMigrations, migrationStatus } from './migrations';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString });
  try {
    const command = process.argv[2] ?? 'up';
    const status =
      command === 'status'
        ? await migrationStatus(pool)
        : command === 'up'
          ? await applyMigrations(pool)
          : (() => {
              throw new Error('Migration command must be "up" or "status"');
            })();
    for (const migration of status) {
      console.log(
        `${migration.applied ? 'applied' : 'pending'} ${migration.name}`,
      );
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'migration_failed';
  console.error(`PostgreSQL migration failed (${code}).`);
  process.exitCode = 1;
});
