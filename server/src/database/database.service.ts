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

export interface DatabasePool {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
}

export type DatabasePoolFactory = (connectionString: string) => DatabasePool;
export type DatabaseHealth = 'disabled' | 'ok' | 'unavailable';

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

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    if (!this.pool) throw new Error('PostgreSQL is not available');
    return this.pool.query<Row>(text, values);
  }
}
