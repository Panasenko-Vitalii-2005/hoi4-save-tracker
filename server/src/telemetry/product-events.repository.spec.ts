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
});
