import type { DatabaseExecutor } from '../database/database.service';
import { DatabaseService } from '../database/database.service';
import { ProductEventsRepository } from './product-events.repository';

describe('ProductEventsRepository', () => {
  test('inserts immutable JSON event data without application payload fields', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = new ProductEventsRepository(
      database as unknown as DatabaseService,
    );
    await repository.insert({
      eventName: 'analysis_upload_rejected',
      userId: '11111111-1111-4111-8111-111111111111',
      analysisId: null,
      flowId: '22222222-2222-4222-8222-222222222222',
      properties: {
        errorCode: 'INVALID_SAVE',
        failureStage: 'validation',
      },
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO product_events'),
      [
        'analysis_upload_rejected',
        '11111111-1111-4111-8111-111111111111',
        null,
        '22222222-2222-4222-8222-222222222222',
        null,
        JSON.stringify({
          errorCode: 'INVALID_SAVE',
          failureStage: 'validation',
        }),
      ],
    );
  });

  test('atomically upserts canonical metadata and links a completion event', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'analysis-id' }] })
      .mockResolvedValueOnce({ rows: [] });
    const executor = { query } as unknown as DatabaseExecutor;
    const transaction = jest.fn(
      (
        operation: (database: DatabaseExecutor) => Promise<unknown>,
      ): Promise<unknown> => operation(executor),
    );
    const database = {
      transaction,
    };
    const repository = new ProductEventsRepository(
      database as unknown as DatabaseService,
    );
    const metadata = {
      contentHash: 'a'.repeat(64),
      fileSizeBytes: 100,
      parseDurationMs: 250,
      divisionCount: 12,
      saveFormat: 'plain_text' as const,
    };
    await expect(
      repository.insertCompletion(
        {
          eventName: 'analysis_completed',
          userId: null,
          flowId: '22222222-2222-4222-8222-222222222222',
          properties: { totalDurationMs: 300 },
        },
        metadata,
      ),
    ).resolves.toBe('analysis-id');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO analyses'),
      ['a'.repeat(64), 100, 250, 12, 'plain_text'],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO product_events'),
      [
        'analysis_completed',
        null,
        'analysis-id',
        '22222222-2222-4222-8222-222222222222',
        null,
        JSON.stringify({ totalDurationMs: 300 }),
      ],
    );
  });

  test('links client events by canonical hash and leaves identity/time server-controlled', async () => {
    let capturedSql = '';
    const query = jest.fn((sql: string, values: readonly unknown[]) => {
      capturedSql = sql;
      void values;
      return Promise.resolve({ rows: [{ id: 'event-id' }] });
    });
    const database = { query };
    const repository = new ProductEventsRepository(
      database as unknown as DatabaseService,
    );
    await expect(
      repository.insertClient({
        eventName: 'analysis_section_viewed',
        userId: '11111111-1111-4111-8111-111111111111',
        contentHash: 'a'.repeat(64),
        clientSessionId: '22222222-2222-4222-8222-222222222222',
        properties: { section: 'stockpile' },
      }),
    ).resolves.toBe(true);

    const sql = capturedSql;
    expect(sql).toContain('FROM analyses');
    expect(sql).toContain('analyses.content_hash = $3');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).not.toContain('occurred_at');
    expect(query).toHaveBeenCalledWith(sql, [
      'analysis_section_viewed',
      '11111111-1111-4111-8111-111111111111',
      'a'.repeat(64),
      '22222222-2222-4222-8222-222222222222',
      JSON.stringify({ section: 'stockpile' }),
    ]);
  });

  test('reports a missing canonical analysis without fabricating one', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = new ProductEventsRepository(
      database as unknown as DatabaseService,
    );
    await expect(
      repository.insertClient({
        eventName: 'analysis_opened',
        userId: null,
        contentHash: 'a'.repeat(64),
        clientSessionId: '22222222-2222-4222-8222-222222222222',
        properties: {},
      }),
    ).resolves.toBe(false);
  });
});
