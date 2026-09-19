import { Logger } from '@nestjs/common';
import type { AnalysisAttemptContext } from './product-events.types';
import { ProductEventsRepository } from './product-events.repository';
import { ProductEventsService } from './product-events.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FLOW_ID = '22222222-2222-4222-8222-222222222222';

function attempt(): AnalysisAttemptContext {
  return {
    flowId: FLOW_ID,
    userId: USER_ID,
    startedAtMs: 1,
    stage: 'upload',
    terminalRecorded: false,
  };
}

describe('ProductEventsService', () => {
  const repository = {
    insert: jest.fn().mockResolvedValue(undefined),
    insertCompletion: jest.fn().mockResolvedValue('analysis-id'),
  };
  let service: ProductEventsService;
  let warning: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new ProductEventsService(
      repository as unknown as ProductEventsRepository,
    );
  });

  test('persists the typed start contract and flow/user linkage', async () => {
    await expect(
      service.recordStarted(attempt(), {
        fileSizeBytes: 123,
        saveFormat: 'plain_text',
      }),
    ).resolves.toBe(true);
    expect(repository.insert).toHaveBeenCalledWith({
      eventName: 'analysis_upload_started',
      userId: USER_ID,
      analysisId: null,
      flowId: FLOW_ID,
      properties: { fileSizeBytes: 123, saveFormat: 'plain_text' },
    });
  });

  test.each([
    ['analysis_upload_rejected', 'INVALID_SAVE', 'validation'],
    ['analysis_upload_rejected', 'FILE_TOO_LARGE', 'admission'],
    ['analysis_failed', 'ANALYSIS_TIMEOUT', 'analysis'],
    ['analysis_failed', 'PERSISTENCE_FAILED', 'persistence'],
  ] as const)(
    'persists supported %s contracts',
    async (eventName, errorCode, failureStage) => {
      const method =
        eventName === 'analysis_failed'
          ? service.recordFailed.bind(service)
          : service.recordRejected.bind(service);
      await expect(
        method(attempt(), { errorCode, failureStage }),
      ).resolves.toBe(true);
      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName,
          flowId: FLOW_ID,
          properties: { errorCode, failureStage },
        }),
      );
    },
  );

  test('persists canonical analysis metadata and links completion', async () => {
    const context = attempt();
    context.analysis = {
      contentHash: 'a'.repeat(64),
      fileSizeBytes: 456,
      parseDurationMs: 1230,
      divisionCount: 3250,
      saveFormat: 'zip_text',
    };
    await expect(
      service.recordCompleted(context, { totalDurationMs: 1400 }),
    ).resolves.toBe(true);
    expect(repository.insertCompletion).toHaveBeenCalledWith(
      {
        eventName: 'analysis_completed',
        userId: USER_ID,
        flowId: FLOW_ID,
        properties: { totalDurationMs: 1400 },
      },
      context.analysis,
    );
  });

  test('rejects arbitrary names/properties and invalid identifiers before persistence', async () => {
    const invalid = attempt();
    invalid.flowId = 'not-a-uuid';
    await expect(
      service.recordStarted(invalid, {
        fileSizeBytes: 1,
        fileName: 'private.hoi4',
      } as never),
    ).resolves.toBe(false);
    await expect(
      service.recordRejected(attempt(), {
        errorCode: 'RAW_EXCEPTION',
        failureStage: 'unknown',
        message: 'C:\\private\\save.hoi4',
      } as never),
    ).resolves.toBe(false);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  test('telemetry storage failure is logged safely and never thrown', async () => {
    repository.insert.mockRejectedValueOnce(new Error('private database path'));
    await expect(service.recordStarted(attempt())).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith(
      'Could not record analysis_upload_started: database write failed.',
    );
    expect(warning).not.toHaveBeenCalledWith(
      expect.stringContaining('private database path'),
    );
  });
});
