import { Injectable, Logger } from '@nestjs/common';
import { SAVE_ERRORS } from '../hoi4/save-input.error';
import { ProductEventsRepository } from './product-events.repository';
import {
  ANALYSIS_FAILURE_STAGES,
  ANALYSIS_SAVE_FORMATS,
  type AnalysisAttemptContext,
  type AnalysisCompletedProperties,
  type AnalysisFailureProperties,
  type AnalysisMetadataInput,
  type AnalysisStartedProperties,
  type ProductAnalysisErrorCode,
  type ProductEventName,
} from './product-events.types';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ERROR_CODES = new Set<ProductAnalysisErrorCode>([
  ...(Object.keys(SAVE_ERRORS) as ProductAnalysisErrorCode[]),
  'SAVE_NOT_FOUND',
]);
const FAILURE_STAGES = new Set(ANALYSIS_FAILURE_STAGES);
const SAVE_FORMATS = new Set(ANALYSIS_SAVE_FORMATS);

function optionalPositiveInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}

function optionalSaveFormat(value: unknown): boolean {
  return value === undefined || SAVE_FORMATS.has(value as never);
}

function validPrincipal(value: string | null): boolean {
  return value === null || UUID.test(value);
}

function validStarted(properties: AnalysisStartedProperties): boolean {
  return (
    optionalPositiveInteger(properties.fileSizeBytes) &&
    optionalSaveFormat(properties.saveFormat) &&
    Object.keys(properties).every((key) =>
      ['fileSizeBytes', 'saveFormat'].includes(key),
    )
  );
}

function validFailure(properties: AnalysisFailureProperties): boolean {
  return (
    optionalPositiveInteger(properties.fileSizeBytes) &&
    optionalSaveFormat(properties.saveFormat) &&
    ERROR_CODES.has(properties.errorCode) &&
    FAILURE_STAGES.has(properties.failureStage) &&
    Object.keys(properties).every((key) =>
      ['errorCode', 'failureStage', 'fileSizeBytes', 'saveFormat'].includes(
        key,
      ),
    )
  );
}

function validMetadata(metadata: AnalysisMetadataInput): boolean {
  return (
    HASH.test(metadata.contentHash) &&
    Number.isSafeInteger(metadata.fileSizeBytes) &&
    metadata.fileSizeBytes > 0 &&
    Number.isSafeInteger(metadata.parseDurationMs) &&
    metadata.parseDurationMs >= 0 &&
    Number.isSafeInteger(metadata.divisionCount) &&
    metadata.divisionCount >= 0 &&
    SAVE_FORMATS.has(metadata.saveFormat)
  );
}

@Injectable()
export class ProductEventsService {
  private readonly logger = new Logger(ProductEventsService.name);

  constructor(private readonly events: ProductEventsRepository) {}

  recordStarted(
    attempt: AnalysisAttemptContext,
    properties: AnalysisStartedProperties = {},
  ): Promise<boolean> {
    return this.record(
      'analysis_upload_started',
      attempt,
      properties,
      validStarted(properties),
    );
  }

  recordRejected(
    attempt: AnalysisAttemptContext,
    properties: AnalysisFailureProperties,
  ): Promise<boolean> {
    return this.record(
      'analysis_upload_rejected',
      attempt,
      properties,
      validFailure(properties),
    );
  }

  recordFailed(
    attempt: AnalysisAttemptContext,
    properties: AnalysisFailureProperties,
  ): Promise<boolean> {
    return this.record(
      'analysis_failed',
      attempt,
      properties,
      validFailure(properties),
    );
  }

  async recordCompleted(
    attempt: AnalysisAttemptContext,
    properties: AnalysisCompletedProperties,
  ): Promise<boolean> {
    if (
      !this.validAttempt(attempt) ||
      !attempt.analysis ||
      !validMetadata(attempt.analysis) ||
      !Number.isSafeInteger(properties.totalDurationMs) ||
      properties.totalDurationMs < 0 ||
      Object.keys(properties).some((key) => key !== 'totalDurationMs')
    ) {
      this.warn('analysis_completed', 'invalid telemetry contract');
      return false;
    }
    try {
      await this.events.insertCompletion(
        {
          eventName: 'analysis_completed',
          userId: attempt.userId,
          flowId: attempt.flowId,
          properties,
        },
        attempt.analysis,
      );
      return true;
    } catch {
      this.warn('analysis_completed', 'database write failed');
      return false;
    }
  }

  private async record(
    eventName: Exclude<ProductEventName, 'analysis_completed'>,
    attempt: AnalysisAttemptContext,
    properties: AnalysisStartedProperties | AnalysisFailureProperties,
    validProperties: boolean,
  ): Promise<boolean> {
    if (!this.validAttempt(attempt) || !validProperties) {
      this.warn(eventName, 'invalid telemetry contract');
      return false;
    }
    try {
      await this.events.insert({
        eventName,
        userId: attempt.userId,
        analysisId: null,
        flowId: attempt.flowId,
        properties,
      });
      return true;
    } catch {
      this.warn(eventName, 'database write failed');
      return false;
    }
  }

  private validAttempt(attempt: AnalysisAttemptContext): boolean {
    return UUID.test(attempt.flowId) && validPrincipal(attempt.userId);
  }

  private warn(eventName: ProductEventName, reason: string): void {
    this.logger.warn(`Could not record ${eventName}: ${reason}.`);
  }
}
