import { Test } from '@nestjs/testing';
import type { QueryResult, QueryResultRow } from 'pg';
import { DatabaseModule } from './database.module';
import {
  type DatabasePool,
  DatabaseService,
  type DatabasePoolFactory,
} from './database.service';

function queryResult(): QueryResult<QueryResultRow> {
  return {
    command: 'SELECT',
    rowCount: 1,
    oid: 0,
    rows: [],
    fields: [],
  };
}

function poolDouble() {
  return {
    query: jest.fn().mockResolvedValue(queryResult()),
    end: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DatabaseService', () => {
  test('disabled mode creates no connection and shuts down cleanly', async () => {
    const createPool = jest.fn<ReturnType<DatabasePoolFactory>, []>();
    const service = new DatabaseService(
      { enabled: false, connectionString: null },
      createPool,
    );

    await service.onModuleInit();
    expect(createPool).not.toHaveBeenCalled();
    await expect(service.health()).resolves.toBe('disabled');
    await service.onModuleDestroy();
  });

  test('validates connectivity, reports health and closes its pool', async () => {
    const pool = poolDouble();
    const createPool = jest.fn(() => pool as DatabasePool);
    const service = new DatabaseService(
      {
        enabled: true,
        connectionString: 'postgresql://app:secret@db/hoi4',
      },
      createPool,
    );

    await service.onModuleInit();
    expect(createPool).toHaveBeenCalledWith('postgresql://app:secret@db/hoi4');
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    await expect(service.health()).resolves.toBe('ok');
    await service.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(service.health()).resolves.toBe('unavailable');
  });

  test('fails explicitly and closes a failed startup pool', async () => {
    const pool = poolDouble();
    pool.query.mockRejectedValueOnce(new Error('secret raw driver error'));
    const service = new DatabaseService(
      {
        enabled: true,
        connectionString: 'postgresql://app:secret@db/hoi4',
      },
      () => pool as DatabasePool,
    );

    await expect(service.onModuleInit()).rejects.toThrow(
      'PostgreSQL connectivity validation failed',
    );
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(service.health()).resolves.toBe('unavailable');
  });

  test('the Nest provider initializes without a database in disabled mode', async () => {
    const previous = process.env.HOI4_DATABASE_ENABLED;
    delete process.env.HOI4_DATABASE_ENABLED;
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    await moduleRef.init();
    try {
      await expect(moduleRef.get(DatabaseService).health()).resolves.toBe(
        'disabled',
      );
    } finally {
      await moduleRef.close();
      if (previous === undefined) delete process.env.HOI4_DATABASE_ENABLED;
      else process.env.HOI4_DATABASE_ENABLED = previous;
    }
  });
});
