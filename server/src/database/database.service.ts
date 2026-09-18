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

const DATABASE_HEALTH_TIMEOUT_MS = 2_000;
const DATABASE_HEALTH_CACHE_MS = 5_000;

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
  private healthQuery: Promise<DatabaseHealth> | null = null;
  private healthProbe: Promise<DatabaseHealth> | null = null;
  private healthCache: { status: DatabaseHealth; expiresAt: number } | null =
    null;

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
    this.healthQuery = null;
    this.healthProbe = null;
    this.healthCache = null;
    await pool?.end();
  }

  async health(): Promise<DatabaseHealth> {
    if (!this.config.enabled) return 'disabled';
    if (!this.pool) return 'unavailable';

    if (this.healthCache && this.healthCache.expiresAt > Date.now()) {
      return this.healthCache.status;
    }
    if (this.healthProbe) return this.healthProbe;

    const query = this.healthQuery ?? this.startHealthQuery(this.pool);
    const probe = this.withHealthTimeout(query).then((status) => {
      this.healthCache = {
        status,
        expiresAt: Date.now() + DATABASE_HEALTH_CACHE_MS,
      };
      return status;
    });
    this.healthProbe = probe;
    void probe.finally(() => {
      if (this.healthProbe === probe) this.healthProbe = null;
    });
    return probe;
  }

  private startHealthQuery(pool: DatabasePool): Promise<DatabaseHealth> {
    const query = Promise.resolve()
      .then(() => pool.query('SELECT 1'))
      .then<DatabaseHealth>(() => 'ok')
      .catch<DatabaseHealth>(() => 'unavailable');
    this.healthQuery = query;
    void query.finally(() => {
      if (this.healthQuery === query) this.healthQuery = null;
    });
    return query;
  }

  private withHealthTimeout(
    query: Promise<DatabaseHealth>,
  ): Promise<DatabaseHealth> {
    return new Promise((resolve) => {
      const timeout = setTimeout(
        () => resolve('unavailable'),
        DATABASE_HEALTH_TIMEOUT_MS,
      );
      timeout.unref();
      void query.then((status) => {
        clearTimeout(timeout);
        resolve(status);
      });
    });
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
