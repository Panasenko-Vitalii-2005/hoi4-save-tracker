import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import type { DatabaseConfig } from './database.config';

export const DATABASE_CONFIG = Symbol('DATABASE_CONFIG');
export const DATABASE_POOL_FACTORY = Symbol('DATABASE_POOL_FACTORY');

export interface DatabaseExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface DatabaseClient extends DatabaseExecutor {
  release(): void;
}

export interface DatabasePool extends DatabaseExecutor {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}

export type DatabasePoolFactory = (connectionString: string) => DatabasePool;
export type DatabaseHealth = 'disabled' | 'ok' | 'unavailable';

export class DatabaseUnavailableError extends Error {
  constructor() {
    super('PostgreSQL is not available');
  }
}

export function createDatabasePool(connectionString: string): DatabasePool {
  return new Pool({ connectionString });
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: DatabasePool | null = null;

  constructor(
    @Inject(DATABASE_CONFIG) private readonly config: DatabaseConfig,
    @Inject(DATABASE_POOL_FACTORY)
    private readonly createPool: DatabasePoolFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) return;

    const pool = this.createPool(this.config.connectionString);
    try {
      await pool.query('SELECT 1');
      this.pool = pool;
    } catch {
      await pool.end().catch(() => undefined);
      throw new Error('PostgreSQL connectivity validation failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end();
  }

  async health(): Promise<DatabaseHealth> {
    if (!this.config.enabled) return 'disabled';
    if (!this.pool) return 'unavailable';
    try {
      await this.pool.query('SELECT 1');
      return 'ok';
    } catch {
      return 'unavailable';
    }
  }

  available(): boolean {
    return this.pool !== null;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    if (!this.pool) throw new DatabaseUnavailableError();
    return this.pool.query<Row>(text, values);
  }

  async transaction<T>(
    operation: (client: DatabaseExecutor) => Promise<T>,
  ): Promise<T> {
    if (!this.pool) throw new DatabaseUnavailableError();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
